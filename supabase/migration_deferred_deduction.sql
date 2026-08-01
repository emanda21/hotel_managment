-- =============================================================================
-- Daris Hotel — Migration: Deferred Inventory Deduction
-- =============================================================================
-- Version  : v7
-- Depends  : migration_room_dining.sql (v6) must already be applied.
--
-- What this migration does
-- ------------------------
-- 1. Rewrites `place_order` (v7) — strips ALL stock-validation and deduction
--    logic. The function now ONLY inserts an order row. Stock is no longer
--    consumed when an order is placed.
--
-- 2. Creates `mark_order_served(p_order_id UUID)` — a new atomic function
--    called when the chef marks an order as served on the KDS. This function:
--      a) Guards against double-serving (ALREADY_SERVED check).
--      b) Updates kitchen_status → 'served'.
--      c) Fetches the menu item + quantity from the order.
--      d) Skips stock logic if the item has no recipe.
--      e) Deadlock-safe PASS 1: locks ingredients FOR UPDATE, accumulates
--         shortages, aborts on any deficit (INSUFFICIENT_STOCK).
--      f) PASS 2: deducts stock from store_inventory.
--      g) PASS 3: writes one inventory_logs row per ingredient with
--         reason = 'ORDER_SERVED_DEDUCTION'.
--      h) Returns a full JSONB summary: deductions + low_stock_alerts.
--
-- Safe to run on a LIVE database. All DROP steps use dynamic overload
-- detection so no hard-coded signatures are needed.
-- =============================================================================

BEGIN;

-- ============================================================================
-- PART A — Rewrite place_order as v7 (order-only, no deduction)
-- ============================================================================

-- Step A1 — Drop every existing overload of place_order dynamically
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


-- Step A2 — Create the lean v7 place_order (insert only, no stock logic)
CREATE FUNCTION public.place_order(
    p_menu_item_id          UUID,
    p_quantity              INT,
    p_table_number          INT   DEFAULT NULL,
    p_room_number           TEXT  DEFAULT NULL,
    p_special_instructions  TEXT  DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        special_instructions
    )
    VALUES (
        p_menu_item_id,
        p_quantity,
        p_table_number,
        p_room_number,
        p_special_instructions
    )
    RETURNING id, created_at
    INTO v_order_id, v_created_at;

    -- ── Return order summary ──────────────────────────────────────────────
    --   deductions and low_stock_alerts are always empty at placement time.
    --   They will be populated by mark_order_served when the chef serves the order.
    RETURN jsonb_build_object(
        'order_id',             v_order_id,
        'menu_item_id',         p_menu_item_id,
        'menu_item_name',       v_menu_item_name,
        'quantity',             p_quantity,
        'table_number',         p_table_number,
        'room_number',          p_room_number,
        'special_instructions', p_special_instructions,
        'created_at',           v_created_at,
        'deductions',           '[]'::JSONB,
        'low_stock_alerts',     '[]'::JSONB
    );

END;
$$;

COMMENT ON FUNCTION public.place_order(UUID, INT, INT, TEXT, TEXT) IS
'place_order v7 — order-only, no stock deduction.

Records the order in the orders table and returns the order summary.
Stock validation and deduction have been moved to mark_order_served(),
which is called when the chef marks the order as served on the KDS.

Parameters
----------
  p_menu_item_id         UUID      — Must exist in menu_items.
  p_quantity             INT       — Number of servings (>= 1).
  p_table_number         INT NULL  — Dine-in table number (optional).
  p_room_number          TEXT NULL — Hotel room for in-room dining (optional).
  p_special_instructions TEXT NULL — Guest prep notes for the kitchen (optional).

Returns
-------
JSONB with order_id, menu_item_id, menu_item_name, quantity, table_number,
room_number, special_instructions, created_at, deductions (always []),
low_stock_alerts (always []).';

GRANT EXECUTE ON FUNCTION public.place_order(UUID, INT, INT, TEXT, TEXT)
    TO anon, authenticated;


-- ============================================================================
-- PART B — Create mark_order_served(p_order_id UUID)
-- ============================================================================

-- Drop any existing overload first (idempotent)
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


CREATE FUNCTION public.mark_order_served(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    -- GUARD 2 — Order must not already be served (idempotency guard)
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
    --   Items without a recipe (pre-packaged goods, drinks, etc.)
    --   skip all stock logic and return immediately.
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
        ORDER  BY si.id          -- consistent lock order avoids deadlock
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
    -- PASS 2 — Deduct stock + write audit rows
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

        -- Deduct from store_inventory
        UPDATE public.store_inventory
        SET    stock_level = stock_level - v_total_needed
        WHERE  id = v_ingredient_id;

        -- Write audit log row (reason distinguishes from old placement-era rows)
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

        -- Accumulate deduction summary
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
'mark_order_served — atomic deferred stock deduction (called by KDS on serve).

Called when a chef marks an order as served on the Kitchen Display System.
This is where ingredient inventory is actually deducted from store_inventory.

Parameters
----------
  p_order_id UUID — The order to serve. Must exist and not already be served.

Logic
-----
  1. Validates order exists; raises ORDER_NOT_FOUND (P0002) if not.
  2. Raises ALREADY_SERVED (P0003) if kitchen_status is already served.
  3. Updates orders SET kitchen_status = served.
  4. Looks up menu_item_id + quantity from the order.
  5. Skips stock logic if the menu item has no recipe; returns immediately.
  6. PASS 1 — Row-locks store_inventory (ORDER BY id, deadlock-safe).
              Accumulates all ingredient shortages before aborting.
              Raises INSUFFICIENT_STOCK (P0001) + shortage JSONB on deficit.
  7. PASS 2 — Deducts stock_level per ingredient.
  8. PASS 3 — Inserts inventory_logs rows (reason = ORDER_SERVED_DEDUCTION).
  9. Returns JSONB: order_id, kitchen_status, deductions[], low_stock_alerts[].

All writes run in one PostgreSQL transaction — any failure rolls back
completely (no partial deductions, kitchen_status reverts to previous state).';

GRANT EXECUTE ON FUNCTION public.mark_order_served(UUID)
    TO anon, authenticated;


-- ============================================================================
-- VERIFICATION QUERIES (uncomment to run after migration)
-- ============================================================================
-- -- 1. Confirm place_order v7 exists (should show 5-param signature, no PASS logic):
-- SELECT pg_get_functiondef(oid) FROM pg_proc
-- WHERE proname = 'place_order' AND pronamespace = 'public'::regnamespace;
--
-- -- 2. Confirm mark_order_served exists:
-- SELECT proname, pg_get_function_arguments(oid) AS args
-- FROM   pg_proc
-- WHERE  proname = 'mark_order_served' AND pronamespace = 'public'::regnamespace;
--
-- -- 3. Confirm EXECUTE grants:
-- SELECT routine_name, grantee, privilege_type
-- FROM   information_schema.routine_privileges
-- WHERE  routine_schema = 'public'
-- AND    routine_name IN ('place_order', 'mark_order_served');

COMMIT;
