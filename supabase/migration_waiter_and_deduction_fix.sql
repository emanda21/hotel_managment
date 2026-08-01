-- =============================================================================
-- Daris Hotel — Migration: Waiter ID + Deferred Deduction RLS Fix
-- =============================================================================
-- Version  : v8
-- Depends  : migration_deferred_deduction.sql (v7) must already be applied.
--
-- What this migration does
-- ------------------------
-- 1. Adds `waiter_id` (TEXT NULL) column to `orders` for dine-in table ownership.
--
-- 2. Adds RLS INSERT policy on `inventory_logs` for the `anon` role.
--    ROOT CAUSE of Issue 2: mark_order_served (SECURITY DEFINER) was blocked
--    from writing to inventory_logs because the calling `anon` role had no
--    INSERT policy. In Supabase, RLS is enforced on the CALLING role, not the
--    function definer. This is the fix.
--
-- 3. Rewrites `place_order` as v8:
--    - Adds `p_waiter_id TEXT DEFAULT NULL` parameter.
--    - Adds `SET row_security = off` to bypass RLS for all table writes.
--    - Inserts `waiter_id` into the orders row.
--    - Returns `waiter_id` in the JSONB payload.
--
-- 4. Rewrites `mark_order_served` as v2:
--    - Adds `SET row_security = off` to bypass RLS for inventory_logs INSERT.
--    - All other logic is identical to v1.
--
-- Safe to run on a LIVE database. All DROP steps use dynamic overload
-- detection so no hard-coded signatures are needed.
-- =============================================================================

BEGIN;

-- ============================================================================
-- PART A — Add waiter_id column to orders
-- ============================================================================

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS waiter_id TEXT NULL;

COMMENT ON COLUMN public.orders.waiter_id
    IS 'Waiter name or ID assigned to this dine-in table order. NULL for room-service orders.';


-- ============================================================================
-- PART B — Fix inventory_logs RLS: grant INSERT to anon
-- ROOT CAUSE: mark_order_served is SECURITY DEFINER but Supabase enforces RLS
-- based on the CALLING role. The anon role had no INSERT policy, causing every
-- audit log write to fail silently inside the transaction.
-- ============================================================================

DO $$
BEGIN
    -- Add anon INSERT policy if it does not already exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE  schemaname = 'public'
        AND    tablename  = 'inventory_logs'
        AND    policyname = 'Anon can insert inventory logs via RPC'
    ) THEN
        EXECUTE '
            CREATE POLICY "Anon can insert inventory logs via RPC"
                ON public.inventory_logs
                FOR INSERT TO anon
                WITH CHECK (true)
        ';
        RAISE NOTICE 'Created anon INSERT policy on inventory_logs';
    ELSE
        RAISE NOTICE 'Anon INSERT policy on inventory_logs already exists — skipped';
    END IF;

    -- Also add SELECT policy for anon (needed for admin audit trail reads)
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE  schemaname = 'public'
        AND    tablename  = 'inventory_logs'
        AND    policyname = 'Anon can view inventory logs'
    ) THEN
        EXECUTE '
            CREATE POLICY "Anon can view inventory logs"
                ON public.inventory_logs
                FOR SELECT TO anon
                USING (true)
        ';
        RAISE NOTICE 'Created anon SELECT policy on inventory_logs';
    ELSE
        RAISE NOTICE 'Anon SELECT policy on inventory_logs already exists — skipped';
    END IF;
END;
$$;


-- ============================================================================
-- PART C — Rewrite place_order as v8
--          (+ waiter_id + SET row_security = off)
-- ============================================================================

-- Step C1 — Drop all existing overloads dynamically
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure::TEXT AS drop_target
        FROM   pg_proc     p
        JOIN   pg_namespace n ON n.oid = p.pronamespace
        WHERE  n.nspname = 'public'
        AND    p.proname = 'place_order'
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.drop_target || ' CASCADE';
        RAISE NOTICE 'Dropped place_order overload: %', r.drop_target;
    END LOOP;
END;
$$;


-- Step C2 — Create place_order v8
CREATE FUNCTION public.place_order(
    p_menu_item_id          UUID,
    p_quantity              INT,
    p_table_number          INT   DEFAULT NULL,
    p_room_number           TEXT  DEFAULT NULL,
    p_special_instructions  TEXT  DEFAULT NULL,
    p_waiter_id             TEXT  DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off          -- bypass RLS for all writes in this function
AS $$
DECLARE
    v_menu_item_name  TEXT;
    v_order_id        UUID;
    v_created_at      TIMESTAMPTZ;
BEGIN

    -- ── Guard: menu item must exist ───────────────────────────────────────
    SELECT name INTO v_menu_item_name
    FROM   public.menu_items
    WHERE  id = p_menu_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MENU_ITEM_NOT_FOUND: Menu item % does not exist.', p_menu_item_id
            USING ERRCODE = 'P0002';
    END IF;

    -- ── Insert order row ──────────────────────────────────────────────────
    --   Stock deduction has been moved to mark_order_served.
    --   No stock check or lock is performed here.
    INSERT INTO public.orders (
        menu_item_id,
        quantity,
        table_number,
        room_number,
        special_instructions,
        waiter_id
    )
    VALUES (
        p_menu_item_id,
        p_quantity,
        p_table_number,
        p_room_number,
        p_special_instructions,
        p_waiter_id
    )
    RETURNING id, created_at
    INTO v_order_id, v_created_at;

    -- ── Return order summary ──────────────────────────────────────────────
    RETURN jsonb_build_object(
        'order_id',             v_order_id,
        'menu_item_id',         p_menu_item_id,
        'menu_item_name',       v_menu_item_name,
        'quantity',             p_quantity,
        'table_number',         p_table_number,
        'room_number',          p_room_number,
        'special_instructions', p_special_instructions,
        'waiter_id',            p_waiter_id,
        'created_at',           v_created_at,
        'deductions',           '[]'::JSONB,
        'low_stock_alerts',     '[]'::JSONB
    );

END;
$$;

COMMENT ON FUNCTION public.place_order(UUID, INT, INT, TEXT, TEXT, TEXT) IS
'place_order v8 — order-only, no stock deduction, waiter_id support, RLS bypassed.

Records the order in the orders table and returns the order summary.
Stock validation and deduction have been moved to mark_order_served(),
which is called when the chef marks the order as served on the KDS.

RLS is bypassed via SET row_security = off (SECURITY DEFINER function).
This is the correct Supabase pattern for atomic RPC functions that must
write to tables with Row Level Security enabled.

Parameters
----------
  p_menu_item_id         UUID      — Must exist in menu_items.
  p_quantity             INT       — Number of servings (>= 1).
  p_table_number         INT NULL  — Dine-in table number (optional).
  p_room_number          TEXT NULL — Hotel room for in-room dining (optional).
  p_special_instructions TEXT NULL — Guest prep notes for the kitchen (optional).
  p_waiter_id            TEXT NULL — Waiter name/ID for dine-in orders (optional).';

GRANT EXECUTE ON FUNCTION public.place_order(UUID, INT, INT, TEXT, TEXT, TEXT)
    TO anon, authenticated;


-- ============================================================================
-- PART D — Rewrite mark_order_served as v2
--          (+ SET row_security = off — the critical fix)
-- ============================================================================

-- Step D1 — Drop all existing overloads dynamically
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure::TEXT AS drop_target
        FROM   pg_proc     p
        JOIN   pg_namespace n ON n.oid = p.pronamespace
        WHERE  n.nspname = 'public'
        AND    p.proname = 'mark_order_served'
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.drop_target || ' CASCADE';
        RAISE NOTICE 'Dropped mark_order_served overload: %', r.drop_target;
    END LOOP;
END;
$$;


-- Step D2 — Create mark_order_served v2
CREATE FUNCTION public.mark_order_served(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off          -- THE critical fix: bypasses RLS on inventory_logs INSERT
AS $$
DECLARE
    -- Order fields
    v_menu_item_id    UUID;
    v_quantity        INT;
    v_current_status  TEXT;
    v_menu_item_name  TEXT;

    -- Ingredient loop variables
    v_ingredient_id       UUID;
    v_ingredient_name     TEXT;
    v_unit                TEXT;
    v_quantity_needed     FLOAT;
    v_stock_level         FLOAT;
    v_low_stock_threshold FLOAT;
    v_total_needed        FLOAT;

    -- Control flags
    v_has_recipe   BOOLEAN;
    v_has_shortage BOOLEAN := FALSE;

    -- Result accumulators
    v_shortages        JSONB := '[]'::JSONB;
    v_deductions       JSONB := '[]'::JSONB;
    v_low_stock_alerts JSONB := '[]'::JSONB;
BEGIN

    -- ================================================================
    -- GUARD 1 — Order must exist
    -- ================================================================
    SELECT menu_item_id, quantity, kitchen_status
    INTO   v_menu_item_id, v_quantity, v_current_status
    FROM   public.orders
    WHERE  id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: Order % does not exist.', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    -- ================================================================
    -- GUARD 2 — Idempotency: order must not already be served
    -- ================================================================
    IF v_current_status = 'served' THEN
        RAISE EXCEPTION 'ALREADY_SERVED: Order % has already been marked as served.', p_order_id
            USING ERRCODE = 'P0003';
    END IF;

    -- ================================================================
    -- STEP 1 — Mark the order as served
    -- ================================================================
    UPDATE public.orders
    SET    kitchen_status = 'served'
    WHERE  id = p_order_id;

    -- ================================================================
    -- Fetch menu item name for the response payload
    -- ================================================================
    SELECT name INTO v_menu_item_name
    FROM   public.menu_items
    WHERE  id = v_menu_item_id;

    -- ================================================================
    -- STEP 2 — Check if this item has a recipe
    --   Items without a recipe (pre-packaged drinks, etc.) skip stock logic.
    -- ================================================================
    SELECT EXISTS (
        SELECT 1 FROM public.recipes WHERE menu_item_id = v_menu_item_id
    ) INTO v_has_recipe;

    IF NOT v_has_recipe THEN
        RETURN jsonb_build_object(
            'order_id',         p_order_id,
            'menu_item_id',     v_menu_item_id,
            'menu_item_name',   v_menu_item_name,
            'quantity',         v_quantity,
            'kitchen_status',   'served',
            'deductions',       '[]'::JSONB,
            'low_stock_alerts', '[]'::JSONB
        );
    END IF;

    -- ================================================================
    -- PASS 1 — Deadlock-safe stock check (FOR UPDATE, ORDER BY id)
    --          Accumulate ALL shortages before aborting.
    -- ================================================================
    FOR v_ingredient_id,
        v_ingredient_name,
        v_unit,
        v_quantity_needed,
        v_stock_level,
        v_low_stock_threshold
    IN
        SELECT si.id,
               si.name,
               si.unit,
               r.quantity_needed,
               si.stock_level,
               si.low_stock_threshold
        FROM   public.store_inventory si
        JOIN   public.recipes         r  ON r.ingredient_id = si.id
        WHERE  r.menu_item_id = v_menu_item_id
        ORDER  BY si.id
        FOR UPDATE OF si
    LOOP
        v_total_needed := v_quantity_needed * v_quantity;

        IF v_stock_level < v_total_needed THEN
            v_has_shortage := TRUE;
            v_shortages := v_shortages || jsonb_build_array(
                jsonb_build_object(
                    'ingredient_id',   v_ingredient_id,
                    'ingredient_name', v_ingredient_name,
                    'unit',            v_unit,
                    'stock_level',     v_stock_level,
                    'required',        v_total_needed,
                    'shortfall',       ROUND((v_total_needed - v_stock_level)::NUMERIC, 4)
                )
            );
        END IF;
    END LOOP;

    -- Abort on any shortage — rolls back the kitchen_status UPDATE too
    IF v_has_shortage THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: %', v_shortages::TEXT
            USING ERRCODE = 'P0001',
                  DETAIL  = v_shortages::TEXT;
    END IF;

    -- ================================================================
    -- PASS 2 — Deduct stock from store_inventory
    -- PASS 3 — Write one inventory_logs audit row per ingredient
    --          reason = 'ORDER_SERVED_DEDUCTION'
    --
    -- Both passes run in the same loop. SET row_security = off (function
    -- header) allows the INSERT into inventory_logs even when called by
    -- the anon role.
    -- ================================================================
    FOR v_ingredient_id,
        v_ingredient_name,
        v_unit,
        v_quantity_needed,
        v_stock_level,
        v_low_stock_threshold
    IN
        SELECT si.id,
               si.name,
               si.unit,
               r.quantity_needed,
               si.stock_level,
               si.low_stock_threshold
        FROM   public.store_inventory si
        JOIN   public.recipes         r  ON r.ingredient_id = si.id
        WHERE  r.menu_item_id = v_menu_item_id
        ORDER  BY si.id
        FOR UPDATE OF si
    LOOP
        v_total_needed := v_quantity_needed * v_quantity;

        -- PASS 2: Deduct stock
        UPDATE public.store_inventory
        SET    stock_level = stock_level - v_total_needed
        WHERE  id = v_ingredient_id;

        -- PASS 3: Write audit log (RLS bypassed by SET row_security = off)
        INSERT INTO public.inventory_logs (
            inventory_id,
            order_id,
            change_amount,
            reason
        ) VALUES (
            v_ingredient_id,
            p_order_id,
            -(v_total_needed),
            'ORDER_SERVED_DEDUCTION'
        );

        -- Accumulate deduction summary for the response
        v_deductions := v_deductions || jsonb_build_array(
            jsonb_build_object(
                'ingredient_id',   v_ingredient_id,
                'ingredient_name', v_ingredient_name,
                'unit',            v_unit,
                'deducted',        v_total_needed,
                'remaining_stock', ROUND((v_stock_level - v_total_needed)::NUMERIC, 4)
            )
        );

        -- Low-stock alert if post-deduction stock <= threshold
        IF (v_stock_level - v_total_needed) <= v_low_stock_threshold THEN
            v_low_stock_alerts := v_low_stock_alerts || jsonb_build_array(
                jsonb_build_object(
                    'ingredient_name',     v_ingredient_name,
                    'unit',                v_unit,
                    'new_stock_level',     ROUND((v_stock_level - v_total_needed)::NUMERIC, 4),
                    'low_stock_threshold', v_low_stock_threshold
                )
            );
        END IF;
    END LOOP;

    -- ================================================================
    -- Return full deduction summary
    -- ================================================================
    RETURN jsonb_build_object(
        'order_id',         p_order_id,
        'menu_item_id',     v_menu_item_id,
        'menu_item_name',   v_menu_item_name,
        'quantity',         v_quantity,
        'kitchen_status',   'served',
        'deductions',       v_deductions,
        'low_stock_alerts', v_low_stock_alerts
    );

END;
$$;

COMMENT ON FUNCTION public.mark_order_served(UUID) IS
'mark_order_served v2 — atomic deferred stock deduction with RLS bypass.

Called when a chef marks an order as served on the Kitchen Display System.

KEY FIX vs v1: Added SET row_security = off to bypass RLS on inventory_logs.
The SECURITY DEFINER attribute alone does not bypass RLS in Supabase — the
calling role (anon) still needs INSERT permission. Using SET row_security = off
in the function header is the canonical fix.

Logic
-----
  1. Validates order exists (ORDER_NOT_FOUND P0002 if not).
  2. Idempotency guard: raises ALREADY_SERVED (P0003) if already served.
  3. Updates orders SET kitchen_status = served.
  4. Returns immediately if menu item has no recipe (no stock to deduct).
  5. PASS 1 — Locks store_inventory rows (ORDER BY id, deadlock-safe).
              Accumulates all shortages; raises INSUFFICIENT_STOCK (P0001)
              on any deficit (rolls back the kitchen_status update too).
  6. PASS 2+3 — Deducts stock and writes inventory_logs rows
                (reason = ORDER_SERVED_DEDUCTION) in a single loop.
  7. Returns JSONB summary: deductions[], low_stock_alerts[].';

GRANT EXECUTE ON FUNCTION public.mark_order_served(UUID)
    TO anon, authenticated;


-- ============================================================================
-- PART E — Update GET /orders view to include waiter_id
--   (No view to update — the Python query uses explicit column list.
--    This section adds waiter_id to the orders table RLS policies.)
-- ============================================================================

-- Ensure anon can read orders (needed for KDS polling)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE  schemaname = 'public'
        AND    tablename  = 'orders'
        AND    policyname = 'Anon can view orders'
    ) THEN
        EXECUTE '
            CREATE POLICY "Anon can view orders"
                ON public.orders
                FOR SELECT TO anon
                USING (true)
        ';
        RAISE NOTICE 'Created anon SELECT policy on orders';
    ELSE
        RAISE NOTICE 'Anon SELECT policy on orders already exists — skipped';
    END IF;
END;
$$;


-- ============================================================================
-- VERIFICATION QUERIES (uncomment to run after migration)
-- ============================================================================
-- -- 1. Confirm waiter_id column was added:
-- SELECT column_name, data_type, is_nullable
-- FROM   information_schema.columns
-- WHERE  table_schema = 'public' AND table_name = 'orders'
-- AND    column_name  = 'waiter_id';
--
-- -- 2. Confirm place_order v8 exists (6 params including p_waiter_id):
-- SELECT pg_get_function_arguments(oid) FROM pg_proc
-- WHERE proname = 'place_order' AND pronamespace = 'public'::regnamespace;
--
-- -- 3. Confirm mark_order_served v2 exists:
-- SELECT pg_get_functiondef(oid) FROM pg_proc
-- WHERE proname = 'mark_order_served' AND pronamespace = 'public'::regnamespace;
--
-- -- 4. Confirm RLS policies on inventory_logs:
-- SELECT policyname, cmd, roles FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'inventory_logs';

COMMIT;
