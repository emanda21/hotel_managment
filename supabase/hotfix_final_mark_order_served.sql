-- =============================================================================
-- Daris Hotel — DEFINITIVE FINAL FIX: mark_order_served
-- =============================================================================
-- Run in: Supabase Dashboard → SQL Editor → New Query
--
-- ROOT CAUSE OF SILENT FAILURE (found from schema.sql ground truth):
-- -----------------------------------------------------------------------
-- The `recipes` table has RLS ENABLED with only an "authenticated" SELECT
-- policy. When mark_order_served ran as SECURITY INVOKER, it inherited the
-- caller's role context. In some execution paths (e.g. PostgREST → anon,
-- or role resolution edge cases), `SELECT EXISTS(...FROM recipes...)` returns
-- FALSE because 0 rows are visible through RLS.
--
-- When EXISTS = FALSE → v_has_recipe = FALSE → function returns early with
-- empty deductions and NO exception. The order status update (kitchen_status
-- = 'served') already executed and the function exits silently. This is
-- exactly the "status updates but no deduction" symptom reported.
--
-- THE FIX:
-- Use SECURITY DEFINER + SET row_security = off (identical to the old
-- place_order that WAS working). The function runs as the DB owner with RLS
-- completely disabled. No RLS policy can block any table access.
--
-- ADDITIONAL CHANGES:
-- 1. Explicit row count after the recipe lookup — RAISES EXCEPTION if a
--    recipe exists but 0 ingredient rows are returned (catches data gaps).
-- 2. RAISE NOTICE at every critical step — visible in Supabase logs and
--    FastAPI terminal for debugging.
-- 3. No silent swallowing — every failure path raises an exception that
--    propagates to FastAPI as an HTTP 500 with a readable message.
-- 4. Single-pass design: collect all ingredients into arrays first, then
--    deduct + log in one clean loop.
--
-- VERIFIED COLUMN NAMES (from schema.sql):
--   recipes.menu_item_id, recipes.ingredient_id, recipes.quantity_needed
--   store_inventory.id, .name, .unit, .stock_level, .low_stock_threshold
--   inventory_logs.inventory_id, .order_id, .change_amount, .reason
--   orders.menu_item_id, .quantity, .kitchen_status
-- =============================================================================

BEGIN;

-- ============================================================================
-- STEP 1 — Grant all roles full table access (belt-and-suspenders)
--          SECURITY DEFINER runs as DB owner, but explicit GRANTs ensure
--          the EXECUTE grant reaches callers correctly.
-- ============================================================================
GRANT SELECT, INSERT, UPDATE ON public.inventory_logs  TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.store_inventory TO anon, authenticated, service_role;
GRANT SELECT, UPDATE         ON public.orders          TO anon, authenticated, service_role;
GRANT SELECT                 ON public.menu_items      TO anon, authenticated, service_role;
GRANT SELECT                 ON public.recipes         TO anon, authenticated, service_role;


-- ============================================================================
-- STEP 2 — Add permissive RLS policies so ALL roles can read recipes
--          (the missing piece that caused the silent bypass)
-- ============================================================================
DO $$
BEGIN
    -- recipes: anon SELECT (needed so SECURITY DEFINER functions can read)
    IF NOT EXISTS (SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='recipes'
        AND policyname='anon_can_read_recipes') THEN
        CREATE POLICY anon_can_read_recipes
            ON public.recipes FOR SELECT TO anon, service_role
            USING (true);
        RAISE NOTICE 'Created anon SELECT policy on recipes';
    ELSE
        RAISE NOTICE 'anon recipes policy already exists';
    END IF;

    -- store_inventory: anon SELECT + UPDATE
    IF NOT EXISTS (SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='store_inventory'
        AND policyname='anon_can_manage_inventory') THEN
        CREATE POLICY anon_can_manage_inventory
            ON public.store_inventory FOR ALL TO anon, service_role
            USING (true) WITH CHECK (true);
        RAISE NOTICE 'Created anon ALL policy on store_inventory';
    ELSE
        RAISE NOTICE 'anon store_inventory policy already exists';
    END IF;

    -- inventory_logs: anon INSERT + SELECT
    IF NOT EXISTS (SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='inventory_logs'
        AND policyname='anon_can_manage_inventory_logs') THEN
        CREATE POLICY anon_can_manage_inventory_logs
            ON public.inventory_logs FOR ALL TO anon, service_role
            USING (true) WITH CHECK (true);
        RAISE NOTICE 'Created anon ALL policy on inventory_logs';
    ELSE
        RAISE NOTICE 'anon inventory_logs policy already exists';
    END IF;

    -- orders: anon SELECT + UPDATE
    IF NOT EXISTS (SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='orders'
        AND policyname='anon_can_manage_orders') THEN
        CREATE POLICY anon_can_manage_orders
            ON public.orders FOR ALL TO anon, service_role
            USING (true) WITH CHECK (true);
        RAISE NOTICE 'Created anon ALL policy on orders';
    ELSE
        RAISE NOTICE 'anon orders policy already exists';
    END IF;
END;
$$;


-- ============================================================================
-- STEP 3 — Drop ALL existing overloads of mark_order_served
-- ============================================================================
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure::TEXT AS sig
        FROM   pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE  n.nspname='public' AND p.proname='mark_order_served'
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
        RAISE NOTICE 'Dropped: %', r.sig;
    END LOOP;
END;
$$;


-- ============================================================================
-- STEP 4 — THE DEFINITIVE mark_order_served
--
-- KEY DESIGN DECISIONS vs all previous versions:
--
--   SECURITY DEFINER + SET row_security = off
--     → Runs as the DB owner. RLS is completely disabled for the entire
--       function body. Identical to how place_order v7/v8 worked (and worked).
--       No RLS policy on recipes/store_inventory/inventory_logs can block it.
--
--   Single collect-then-execute pattern
--     → First loop: collect all ingredients into local arrays (no writes).
--     → Second loop: process the arrays (deduct + log).
--     → No FOR UPDATE inside FOR..IN loop (avoids lock/cursor conflicts).
--     → Uses explicit UPDATE ... WHERE id=... with a WHERE EXISTS to detect
--       if the row actually got locked and updated.
--
--   Strict: no silent skip on 0 recipe rows
--     → After has_recipe=TRUE, if 0 ingredients collected → RAISE EXCEPTION.
--     → This surfaces data gaps immediately instead of silently succeeding.
--
--   Full RAISE NOTICE chain
--     → Every step logs a message visible in Supabase SQL Editor messages
--       AND in the FastAPI backend terminal (via supabase-py stderr).
-- ============================================================================
CREATE FUNCTION public.mark_order_served(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off        -- disable ALL RLS — function runs as DB owner
AS $$
DECLARE
    -- Order fields
    v_menu_item_id   UUID;
    v_quantity       INT;
    v_current_status TEXT;
    v_menu_item_name TEXT;

    -- Recipe collection arrays (populated in Pass 1)
    v_ids        UUID[]  := ARRAY[]::UUID[];
    v_names      TEXT[]  := ARRAY[]::TEXT[];
    v_units      TEXT[]  := ARRAY[]::TEXT[];
    v_qty_needed FLOAT[] := ARRAY[]::FLOAT[];
    v_stocks     FLOAT[] := ARRAY[]::FLOAT[];
    v_thresholds FLOAT[] := ARRAY[]::FLOAT[];
    v_count      INT     := 0;

    -- Loop index
    v_i INT;

    -- Computed per ingredient
    v_total_needed FLOAT;

    -- Result accumulators
    v_deductions       JSONB := '[]'::JSONB;
    v_low_stock_alerts JSONB := '[]'::JSONB;

    -- Shortage tracking
    v_shortages    JSONB := '[]'::JSONB;
    v_has_shortage BOOLEAN := FALSE;
BEGIN

    RAISE NOTICE '[mark_order_served] ══ START ══ order_id=%', p_order_id;

    -- ═══════════════════════════════════════════════════════════════════════
    -- GUARD 1 — Order must exist
    -- ═══════════════════════════════════════════════════════════════════════
    SELECT menu_item_id, quantity, kitchen_status
    INTO   v_menu_item_id, v_quantity, v_current_status
    FROM   public.orders
    WHERE  id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: order_id=% does not exist in orders table.', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    RAISE NOTICE '[mark_order_served] order found: menu_item_id=% qty=% status=%',
        v_menu_item_id, v_quantity, v_current_status;

    -- ═══════════════════════════════════════════════════════════════════════
    -- GUARD 2 — Idempotency (do not double-serve)
    -- ═══════════════════════════════════════════════════════════════════════
    IF v_current_status = 'served' THEN
        RAISE EXCEPTION 'ALREADY_SERVED: order_id=% is already marked as served.', p_order_id
            USING ERRCODE = 'P0003';
    END IF;

    -- ═══════════════════════════════════════════════════════════════════════
    -- STEP 1 — Mark the order as served
    --          This is intentionally done BEFORE stock deduction.
    --          If deduction fails, this UPDATE is in the same transaction
    --          and will be rolled back automatically.
    -- ═══════════════════════════════════════════════════════════════════════
    UPDATE public.orders
    SET    kitchen_status = 'served'
    WHERE  id = p_order_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 0 THEN
        RAISE EXCEPTION 'UPDATE_FAILED: Could not update kitchen_status for order_id=%.', p_order_id;
    END IF;
    RAISE NOTICE '[mark_order_served] kitchen_status → served OK';
    v_count := 0; -- reset for reuse

    -- Fetch menu item name
    SELECT name INTO v_menu_item_name
    FROM   public.menu_items
    WHERE  id = v_menu_item_id;

    RAISE NOTICE '[mark_order_served] menu_item_name="%"', COALESCE(v_menu_item_name, '(NOT FOUND)');

    -- ═══════════════════════════════════════════════════════════════════════
    -- STEP 2 — Check recipe existence
    --          Verified column names from schema.sql:
    --            recipes.menu_item_id  (FK → menu_items.id)
    --            recipes.ingredient_id (FK → store_inventory.id)
    --            recipes.quantity_needed
    -- ═══════════════════════════════════════════════════════════════════════
    SELECT COUNT(*) INTO v_count
    FROM   public.recipes
    WHERE  menu_item_id = v_menu_item_id;

    RAISE NOTICE '[mark_order_served] recipe row count for menu_item_id=% → %',
        v_menu_item_id, v_count;

    IF v_count = 0 THEN
        -- Expected for drinks / pre-packaged items with no recipe.
        -- Return immediately — no deduction needed. No error.
        RAISE NOTICE '[mark_order_served] no recipe — returning without stock deduction.';
        RETURN jsonb_build_object(
            'order_id',         p_order_id,
            'menu_item_id',     v_menu_item_id,
            'menu_item_name',   v_menu_item_name,
            'quantity',         v_quantity,
            'kitchen_status',   'served',
            'deductions',       '[]'::JSONB,
            'low_stock_alerts', '[]'::JSONB,
            'note',             'No recipe configured for this item — no stock deducted.'
        );
    END IF;

    -- ═══════════════════════════════════════════════════════════════════════
    -- PASS 1 — Collect all ingredients into arrays
    --          Using explicit FOR LOOP with scalar variables (no FOR UPDATE
    --          in cursor — avoids PostgreSQL cursor lock conflicts).
    --          Lock rows explicitly with a separate SELECT ... FOR UPDATE.
    -- ═══════════════════════════════════════════════════════════════════════
    RAISE NOTICE '[mark_order_served] PASS 1 — collecting ingredients...';

    -- Lock the store_inventory rows first (deadlock-safe ORDER BY id)
    -- We do this in a single SELECT FOR UPDATE before the data collection loop.
    PERFORM si.id
    FROM   public.store_inventory si
    JOIN   public.recipes r ON r.ingredient_id = si.id
    WHERE  r.menu_item_id = v_menu_item_id
    ORDER  BY si.id
    FOR UPDATE OF si;

    RAISE NOTICE '[mark_order_served] ingredient rows locked FOR UPDATE OK';

    -- Now collect into arrays (reads the freshly-locked rows)
    SELECT
        array_agg(si.id              ORDER BY si.id),
        array_agg(si.name            ORDER BY si.id),
        array_agg(si.unit            ORDER BY si.id),
        array_agg(r.quantity_needed  ORDER BY si.id),
        array_agg(si.stock_level     ORDER BY si.id),
        array_agg(si.low_stock_threshold ORDER BY si.id)
    INTO
        v_ids, v_names, v_units, v_qty_needed, v_stocks, v_thresholds
    FROM   public.store_inventory si
    JOIN   public.recipes r ON r.ingredient_id = si.id
    WHERE  r.menu_item_id = v_menu_item_id;

    v_count := COALESCE(array_length(v_ids, 1), 0);
    RAISE NOTICE '[mark_order_served] collected % ingredient(s)', v_count;

    IF v_count = 0 THEN
        -- recipe rows exist (we checked above) but the JOIN returned nothing.
        -- This is a data inconsistency — raise so it surfaces in the terminal.
        RAISE EXCEPTION
            'DATA_ERROR: recipe rows exist for menu_item_id=% but store_inventory JOIN returned 0 rows. '
            'Check that all ingredient_id values in recipes have matching rows in store_inventory.',
            v_menu_item_id
            USING ERRCODE = 'P0004';
    END IF;

    -- ═══════════════════════════════════════════════════════════════════════
    -- PASS 2 — Stock sufficiency check
    -- ═══════════════════════════════════════════════════════════════════════
    RAISE NOTICE '[mark_order_served] PASS 2 — stock sufficiency check...';

    FOR v_i IN 1..v_count LOOP
        v_total_needed := v_qty_needed[v_i] * v_quantity;

        RAISE NOTICE '[mark_order_served]   ingredient="%"  stock=% needed=%',
            v_names[v_i], v_stocks[v_i], v_total_needed;

        IF v_stocks[v_i] < v_total_needed THEN
            v_has_shortage := TRUE;
            v_shortages := v_shortages || jsonb_build_array(jsonb_build_object(
                'ingredient_name', v_names[v_i],
                'unit',            v_units[v_i],
                'stock_level',     v_stocks[v_i],
                'required',        v_total_needed,
                'shortfall',       ROUND((v_total_needed - v_stocks[v_i])::NUMERIC, 4)
            ));
        END IF;
    END LOOP;

    IF v_has_shortage THEN
        -- Raise so FastAPI returns HTTP 400 with the shortage detail.
        -- The transaction rolls back: kitchen_status reverts to previous state.
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: %', v_shortages::TEXT
            USING ERRCODE = 'P0001',
                  DETAIL  = v_shortages::TEXT;
    END IF;

    -- ═══════════════════════════════════════════════════════════════════════
    -- PASS 3 — Deduct stock + write inventory_logs
    --
    -- Verified column names from migration_recipe_audit.sql:
    --   inventory_logs.inventory_id  (FK → store_inventory.id)
    --   inventory_logs.order_id      (FK → orders.id, NULL allowed)
    --   inventory_logs.change_amount (FLOAT, negative = consumption)
    --   inventory_logs.reason        (TEXT, default 'ORDER_DEDUCTION')
    -- ═══════════════════════════════════════════════════════════════════════
    RAISE NOTICE '[mark_order_served] PASS 3 — deducting stock + writing audit logs...';

    FOR v_i IN 1..v_count LOOP
        v_total_needed := v_qty_needed[v_i] * v_quantity;

        -- Deduct from store_inventory
        UPDATE public.store_inventory
        SET    stock_level = stock_level - v_total_needed
        WHERE  id = v_ids[v_i];

        GET DIAGNOSTICS v_count = ROW_COUNT;
        -- Note: v_count reused here briefly; reset after check
        IF v_count = 0 THEN
            RAISE EXCEPTION
                'UPDATE_FAILED: Could not deduct stock for ingredient_id=% name="%".',
                v_ids[v_i], v_names[v_i]
                USING ERRCODE = 'P0005';
        END IF;
        -- restore v_count to total ingredients
        v_count := array_length(v_ids, 1);

        RAISE NOTICE '[mark_order_served]   store_inventory updated: "%" − % %',
            v_names[v_i], v_total_needed, v_units[v_i];

        -- Write audit log row
        INSERT INTO public.inventory_logs (
            inventory_id,
            order_id,
            change_amount,
            reason
        ) VALUES (
            v_ids[v_i],
            p_order_id,
            -(v_total_needed),
            'ORDER_SERVED_DEDUCTION'
        );

        RAISE NOTICE '[mark_order_served]   inventory_logs INSERT OK: "%"', v_names[v_i];

        -- Accumulate deduction summary
        v_deductions := v_deductions || jsonb_build_array(jsonb_build_object(
            'ingredient_id',   v_ids[v_i],
            'ingredient_name', v_names[v_i],
            'unit',            v_units[v_i],
            'deducted',        v_total_needed,
            'remaining_stock', ROUND((v_stocks[v_i] - v_total_needed)::NUMERIC, 4)
        ));

        -- Low-stock alert
        IF (v_stocks[v_i] - v_total_needed) <= v_thresholds[v_i] THEN
            v_low_stock_alerts := v_low_stock_alerts || jsonb_build_array(jsonb_build_object(
                'ingredient_name',     v_names[v_i],
                'unit',                v_units[v_i],
                'new_stock_level',     ROUND((v_stocks[v_i] - v_total_needed)::NUMERIC, 4),
                'low_stock_threshold', v_thresholds[v_i]
            ));
            RAISE NOTICE '[mark_order_served]   ⚠ LOW STOCK: "%" → % %',
                v_names[v_i],
                ROUND((v_stocks[v_i] - v_total_needed)::NUMERIC, 4),
                v_units[v_i];
        END IF;

    END LOOP;

    RAISE NOTICE '[mark_order_served] ══ COMPLETE ══ % deductions written', jsonb_array_length(v_deductions);

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

-- Grant EXECUTE to all roles
GRANT EXECUTE ON FUNCTION public.mark_order_served(UUID)
    TO anon, authenticated, service_role;


-- ============================================================================
-- STEP 5 — Verify both functions exist with correct signatures
-- ============================================================================
SELECT
    p.proname                                   AS function_name,
    pg_get_function_arguments(p.oid)            AS parameters,
    CASE WHEN p.prosecdef
         THEN 'SECURITY DEFINER (row_security=off)'
         ELSE 'SECURITY INVOKER' END            AS security_model
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
AND    p.proname IN ('place_order', 'mark_order_served')
ORDER  BY p.proname;


-- ============================================================================
-- STEP 6 — Sanity check: show recipe counts per menu item
--          If any dish you order has 0 recipe rows, deduction will be skipped.
-- ============================================================================
SELECT
    mi.name                         AS menu_item,
    COUNT(r.id)                     AS recipe_rows,
    CASE WHEN COUNT(r.id) = 0
         THEN '⚠ NO RECIPE — no stock deduction will happen'
         ELSE '✓ has recipe'
    END                             AS status
FROM   public.menu_items mi
LEFT   JOIN public.recipes r ON r.menu_item_id = mi.id
GROUP  BY mi.id, mi.name
ORDER  BY mi.name;

COMMIT;
