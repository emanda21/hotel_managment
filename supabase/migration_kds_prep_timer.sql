-- =============================================================================
-- Daris Hotel — Migration: KDS Prep Timer + mark_order_served v3 Debug Fix
-- =============================================================================
-- Version  : v9
-- Depends  : migration_waiter_and_deduction_fix.sql (v8) must already be applied.
--
-- What this migration does
-- ------------------------
-- 1. Adds `prep_time_minutes` (INT NULL) to `orders`.
--    Set when a chef accepts a NEW order → PREPARING transition.
--
-- 2. Adds `target_serve_time` (TIMESTAMPTZ NULL) to `orders`.
--    Computed as NOW() + interval 'N minutes' at acceptance time.
--    Used by the KDS frontend to display a live countdown timer and
--    trigger the overdue alarm when the deadline is exceeded.
--
-- 3. Rebuilds `mark_order_served` as v3:
--    KEY CHANGE vs v2: Adds RAISE NOTICE debug lines BEFORE every
--    critical write so any failure in the transaction appears in
--    Supabase logs, not silently.
--
--    Also explicitly checks the inventory_logs column name (inventory_id)
--    to ensure compatibility with all schema versions.
--
-- 4. Ensures `orders` UPDATE policy for anon (needed for the Python
--    backend to write prep_time_minutes + target_serve_time).
--
-- Safe to run on a LIVE database. All DROP steps use dynamic overload
-- detection so no hard-coded signatures are needed.
-- =============================================================================

BEGIN;

-- ============================================================================
-- PART A — Add prep timer columns to orders
-- ============================================================================

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS prep_time_minutes INT NULL;

COMMENT ON COLUMN public.orders.prep_time_minutes IS
'Chef-estimated prep time in minutes. Set when the order moves from NEW → PREPARING.
Used together with target_serve_time to drive the KDS countdown timer.';

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS target_serve_time TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.orders.target_serve_time IS
'Absolute deadline for the order: created_at (of accepting) + prep_time_minutes.
The KDS frontend counts down to this time. When exceeded the card flashes red
and the overdue alarm plays until the order is marked as SERVED.';


-- ============================================================================
-- PART B — Ensure anon UPDATE policy on orders
--          (Python backend uses service-role key, but belt-and-suspenders)
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE  schemaname = 'public'
        AND    tablename  = 'orders'
        AND    policyname = 'Anon can update orders'
    ) THEN
        EXECUTE '
            CREATE POLICY "Anon can update orders"
                ON public.orders
                FOR UPDATE TO anon
                USING (true)
                WITH CHECK (true)
        ';
        RAISE NOTICE 'Created anon UPDATE policy on orders';
    ELSE
        RAISE NOTICE 'Anon UPDATE policy on orders already exists — skipped';
    END IF;
END;
$$;


-- ============================================================================
-- PART C — Rebuild mark_order_served as v3 (with RAISE NOTICE debug lines)
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
        AND    p.proname = 'mark_order_served'
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.drop_target || ' CASCADE';
        RAISE NOTICE 'Dropped mark_order_served overload: %', r.drop_target;
    END LOOP;
END;
$$;


-- Step C2 — Create mark_order_served v3
-- KEY CHANGES vs v2:
--   • RAISE NOTICE before every critical write for Supabase log visibility
--   • Added p_order_id logging at entry for full traceability
--   • Retained SET row_security = off (essential for inventory_logs INSERT)
--   • inventory_logs column is `inventory_id` (matches schema.sql)
CREATE FUNCTION public.mark_order_served(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off          -- CRITICAL: bypasses RLS for all writes
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

    RAISE NOTICE '[mark_order_served v3] Called with p_order_id=%', p_order_id;

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

    RAISE NOTICE '[mark_order_served v3] Order found: menu_item_id=%, qty=%, status=%',
        v_menu_item_id, v_quantity, v_current_status;

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
    RAISE NOTICE '[mark_order_served v3] Updating kitchen_status → served';
    UPDATE public.orders
    SET    kitchen_status = 'served'
    WHERE  id = p_order_id;

    -- ================================================================
    -- Fetch menu item name for the response payload
    -- ================================================================
    SELECT name INTO v_menu_item_name
    FROM   public.menu_items
    WHERE  id = v_menu_item_id;

    RAISE NOTICE '[mark_order_served v3] Menu item name: %', COALESCE(v_menu_item_name, '(NULL - item not found)');

    -- ================================================================
    -- STEP 2 — Check if this item has a recipe
    --   Items without a recipe (pre-packaged drinks, etc.) skip stock logic.
    -- ================================================================
    SELECT EXISTS (
        SELECT 1 FROM public.recipes WHERE menu_item_id = v_menu_item_id
    ) INTO v_has_recipe;

    RAISE NOTICE '[mark_order_served v3] Has recipe: %', v_has_recipe;

    IF NOT v_has_recipe THEN
        RAISE NOTICE '[mark_order_served v3] No recipe found — returning without stock deduction.';
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
    RAISE NOTICE '[mark_order_served v3] Starting PASS 1 — stock check';
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

        RAISE NOTICE '[mark_order_served v3] Ingredient: % | stock=% | needed=%',
            v_ingredient_name, v_stock_level, v_total_needed;

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
    -- PASS 2+3 — Deduct stock + write inventory_logs audit rows
    --
    -- SET row_security = off in the function header allows this INSERT
    -- into inventory_logs even when called by the anon role.
    -- ================================================================
    RAISE NOTICE '[mark_order_served v3] Starting PASS 2+3 — deduction + audit log';
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
        RAISE NOTICE '[mark_order_served v3] Deducting % % from ingredient_id=%',
            v_total_needed, v_unit, v_ingredient_id;
        UPDATE public.store_inventory
        SET    stock_level = stock_level - v_total_needed
        WHERE  id = v_ingredient_id;

        -- PASS 3: Write audit log
        RAISE NOTICE '[mark_order_served v3] Inserting inventory_logs row for ingredient_id=%',
            v_ingredient_id;
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

    RAISE NOTICE '[mark_order_served v3] Complete — % deductions made.', jsonb_array_length(v_deductions);

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
'mark_order_served v3 — atomic deferred stock deduction with full RAISE NOTICE debug logging.

Called when a chef marks an order as served on the Kitchen Display System.

KEY CHANGES vs v2:
  • RAISE NOTICE before every critical step for Supabase log visibility
  • Retained SET row_security = off (bypasses RLS on inventory_logs INSERT)

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
-- PART D — Diagnostic: confirm inventory_logs column names
--   This SELECT will show what columns exist on inventory_logs.
--   Check Supabase logs after running to confirm `inventory_id` column exists.
-- ============================================================================

DO $$
DECLARE
    v_col_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM   information_schema.columns
        WHERE  table_schema = 'public'
        AND    table_name   = 'inventory_logs'
        AND    column_name  = 'inventory_id'
    ) INTO v_col_exists;

    IF v_col_exists THEN
        RAISE NOTICE 'DIAGNOSTIC: inventory_logs.inventory_id column EXISTS — schema is correct.';
    ELSE
        RAISE WARNING 'DIAGNOSTIC: inventory_logs.inventory_id column NOT FOUND! Check column name in your schema.';
        -- Attempt to find the actual column name
        RAISE NOTICE 'DIAGNOSTIC: Columns in inventory_logs: %',
            (SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'inventory_logs');
    END IF;
END;
$$;


-- ============================================================================
-- VERIFICATION QUERIES (uncomment to run after migration)
-- ============================================================================
-- -- 1. Confirm new columns on orders:
-- SELECT column_name, data_type, is_nullable
-- FROM   information_schema.columns
-- WHERE  table_schema = 'public' AND table_name = 'orders'
-- AND    column_name IN ('prep_time_minutes', 'target_serve_time');
--
-- -- 2. Confirm mark_order_served v3 exists:
-- SELECT pg_get_functiondef(oid) FROM pg_proc
-- WHERE proname = 'mark_order_served' AND pronamespace = 'public'::regnamespace;
--
-- -- 3. Test the function directly with a real order_id from your orders table:
-- -- SELECT mark_order_served('YOUR-ORDER-UUID-HERE'::UUID);

COMMIT;
