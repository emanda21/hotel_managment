-- =============================================================================
-- Daris Hotel — DEFINITIVE AUDIT DIAGNOSTIC & FIX (Run this now)
-- =============================================================================
-- Run this entire script in: Supabase Dashboard → SQL Editor → New Query
--
-- What it does (in order):
--   1. Checks whether inventory_logs table exists
--   2. Checks whether v_inventory_audit view exists
--   3. Checks whether mark_order_served function exists
--   4. FIXES: grants service_role all needed privileges
--   5. FIXES: drops & recreates mark_order_served with SECURITY INVOKER
--   6. FIXES: recreates v_inventory_audit view with anon SELECT grant
--   7. TEST:  does a live SELECT on v_inventory_audit (shows current rows)
--   8. TEST:  finds a real 'preparing' order and calls mark_order_served on it
--             (the safest way to prove the RPC works end-to-end)
-- =============================================================================

-- ============================================================================
-- STEP 1 — Diagnostics (check what exists)
-- ============================================================================
DO $$
DECLARE
    v_logs_exists   BOOLEAN;
    v_view_exists   BOOLEAN;
    v_func_exists   BOOLEAN;
    v_orders_exists BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='inventory_logs') INTO v_logs_exists;

    SELECT EXISTS (SELECT 1 FROM information_schema.views
        WHERE table_schema='public' AND table_name='v_inventory_audit') INTO v_view_exists;

    SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='mark_order_served') INTO v_func_exists;

    SELECT EXISTS (SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='orders') INTO v_orders_exists;

    RAISE NOTICE '=== DIAGNOSTIC REPORT ===';
    RAISE NOTICE 'inventory_logs table  : %', CASE WHEN v_logs_exists   THEN 'EXISTS ✓' ELSE 'MISSING ✗ — run migration_recipe_audit.sql first!' END;
    RAISE NOTICE 'v_inventory_audit view: %', CASE WHEN v_view_exists   THEN 'EXISTS ✓' ELSE 'MISSING ✗' END;
    RAISE NOTICE 'mark_order_served fn  : %', CASE WHEN v_func_exists   THEN 'EXISTS ✓' ELSE 'MISSING ✗' END;
    RAISE NOTICE 'orders table          : %', CASE WHEN v_orders_exists THEN 'EXISTS ✓' ELSE 'MISSING ✗' END;
    RAISE NOTICE '=========================';
END;
$$;


-- ============================================================================
-- STEP 2 — GRANT service_role full access on all required tables
--          (service_role bypasses RLS in Supabase but still needs GRANT)
-- ============================================================================
GRANT ALL ON public.inventory_logs   TO service_role;
GRANT ALL ON public.store_inventory  TO service_role;
GRANT ALL ON public.orders           TO service_role;
GRANT ALL ON public.menu_items       TO service_role;
GRANT ALL ON public.recipes          TO service_role;

GRANT SELECT ON public.v_inventory_audit TO anon, authenticated, service_role;


-- ============================================================================
-- STEP 3 — Add permissive RLS policies so ALL roles can use inventory_logs
--          (belt-and-suspenders: service_role bypasses RLS anyway)
-- ============================================================================
DO $$
BEGIN
    -- anon INSERT (needed inside SECURITY INVOKER function called as anon)
    IF NOT EXISTS (SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='inventory_logs'
        AND policyname='allow_all_insert_inventory_logs') THEN
        CREATE POLICY allow_all_insert_inventory_logs
            ON public.inventory_logs FOR INSERT TO anon, authenticated, service_role
            WITH CHECK (true);
        RAISE NOTICE 'Created INSERT policy on inventory_logs';
    ELSE
        RAISE NOTICE 'INSERT policy already exists';
    END IF;

    -- anon SELECT (needed so the audit page backend can read rows)
    IF NOT EXISTS (SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='inventory_logs'
        AND policyname='allow_all_select_inventory_logs') THEN
        CREATE POLICY allow_all_select_inventory_logs
            ON public.inventory_logs FOR SELECT TO anon, authenticated, service_role
            USING (true);
        RAISE NOTICE 'Created SELECT policy on inventory_logs';
    ELSE
        RAISE NOTICE 'SELECT policy already exists';
    END IF;
END;
$$;


-- ============================================================================
-- STEP 4 — Drop ALL existing overloads of mark_order_served
-- ============================================================================
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure::TEXT AS sig
        FROM   pg_proc p
        JOIN   pg_namespace n ON n.oid = p.pronamespace
        WHERE  n.nspname='public' AND p.proname='mark_order_served'
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
        RAISE NOTICE 'Dropped: %', r.sig;
    END LOOP;
END;
$$;


-- ============================================================================
-- STEP 5 — Recreate mark_order_served (SECURITY INVOKER — runs as caller)
--
-- WHY SECURITY INVOKER (not DEFINER):
--   The Python backend uses the SERVICE_ROLE key.
--   When service_role calls this RPC, Supabase ALREADY bypasses RLS for
--   service_role at the connection level.
--   With SECURITY INVOKER, the function runs AS service_role → it inherits
--   that RLS bypass for every INSERT/UPDATE inside the function body.
--   With SECURITY DEFINER, it would run as the function owner (postgres),
--   which has its own separate RLS context — and no INSERT policy existed
--   for that role on inventory_logs → silent rollback.
-- ============================================================================
CREATE FUNCTION public.mark_order_served(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_menu_item_id        UUID;
    v_quantity            INT;
    v_current_status      TEXT;
    v_menu_item_name      TEXT;
    v_ingredient_id       UUID;
    v_ingredient_name     TEXT;
    v_unit                TEXT;
    v_quantity_needed     FLOAT;
    v_stock_level         FLOAT;
    v_low_stock_threshold FLOAT;
    v_total_needed        FLOAT;
    v_has_recipe          BOOLEAN;
    v_has_shortage        BOOLEAN := FALSE;
    v_shortages           JSONB   := '[]'::JSONB;
    v_deductions          JSONB   := '[]'::JSONB;
    v_low_stock_alerts    JSONB   := '[]'::JSONB;
BEGIN
    RAISE NOTICE '[mark_order_served] START order=%', p_order_id;

    -- Guard 1: order must exist
    SELECT menu_item_id, quantity, kitchen_status
    INTO   v_menu_item_id, v_quantity, v_current_status
    FROM   public.orders WHERE id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: %', p_order_id USING ERRCODE='P0002';
    END IF;
    RAISE NOTICE '[mark_order_served] order found: item=% qty=% status=%',
        v_menu_item_id, v_quantity, v_current_status;

    -- Guard 2: idempotency
    IF v_current_status = 'served' THEN
        RAISE EXCEPTION 'ALREADY_SERVED: %', p_order_id USING ERRCODE='P0003';
    END IF;

    -- Step 1: mark served
    UPDATE public.orders SET kitchen_status='served' WHERE id=p_order_id;
    RAISE NOTICE '[mark_order_served] orders.kitchen_status → served OK';

    -- Get menu item name
    SELECT name INTO v_menu_item_name FROM public.menu_items WHERE id=v_menu_item_id;
    RAISE NOTICE '[mark_order_served] menu_item_name=%', COALESCE(v_menu_item_name,'(null)');

    -- Step 2: does item have a recipe?
    SELECT EXISTS(SELECT 1 FROM public.recipes WHERE menu_item_id=v_menu_item_id) INTO v_has_recipe;
    RAISE NOTICE '[mark_order_served] has_recipe=%', v_has_recipe;

    IF NOT v_has_recipe THEN
        RAISE NOTICE '[mark_order_served] no recipe — done, no stock deduction';
        RETURN jsonb_build_object(
            'order_id',p_order_id,'menu_item_id',v_menu_item_id,
            'menu_item_name',v_menu_item_name,'quantity',v_quantity,
            'kitchen_status','served','deductions','[]'::JSONB,
            'low_stock_alerts','[]'::JSONB
        );
    END IF;

    -- Pass 1: stock check (lock rows, accumulate shortages)
    RAISE NOTICE '[mark_order_served] PASS 1 — stock check';
    FOR v_ingredient_id, v_ingredient_name, v_unit, v_quantity_needed,
        v_stock_level, v_low_stock_threshold IN
        SELECT si.id, si.name, si.unit, r.quantity_needed, si.stock_level, si.low_stock_threshold
        FROM   public.store_inventory si
        JOIN   public.recipes r ON r.ingredient_id=si.id
        WHERE  r.menu_item_id=v_menu_item_id
        ORDER  BY si.id
        FOR UPDATE OF si
    LOOP
        v_total_needed := v_quantity_needed * v_quantity;
        RAISE NOTICE '[mark_order_served]   ingredient=% stock=% need=%',
            v_ingredient_name, v_stock_level, v_total_needed;
        IF v_stock_level < v_total_needed THEN
            v_has_shortage := TRUE;
            v_shortages := v_shortages || jsonb_build_array(jsonb_build_object(
                'ingredient_name',v_ingredient_name,'unit',v_unit,
                'stock_level',v_stock_level,'required',v_total_needed,
                'shortfall',ROUND((v_total_needed-v_stock_level)::NUMERIC,4)
            ));
        END IF;
    END LOOP;

    IF v_has_shortage THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: %', v_shortages::TEXT
            USING ERRCODE='P0001', DETAIL=v_shortages::TEXT;
    END IF;

    -- Pass 2+3: deduct + audit log
    RAISE NOTICE '[mark_order_served] PASS 2+3 — deduct stock + write inventory_logs';
    FOR v_ingredient_id, v_ingredient_name, v_unit, v_quantity_needed,
        v_stock_level, v_low_stock_threshold IN
        SELECT si.id, si.name, si.unit, r.quantity_needed, si.stock_level, si.low_stock_threshold
        FROM   public.store_inventory si
        JOIN   public.recipes r ON r.ingredient_id=si.id
        WHERE  r.menu_item_id=v_menu_item_id
        ORDER  BY si.id
        FOR UPDATE OF si
    LOOP
        v_total_needed := v_quantity_needed * v_quantity;

        UPDATE public.store_inventory
        SET    stock_level = stock_level - v_total_needed
        WHERE  id = v_ingredient_id;
        RAISE NOTICE '[mark_order_served]   store_inventory updated: %', v_ingredient_name;

        INSERT INTO public.inventory_logs(inventory_id, order_id, change_amount, reason)
        VALUES (v_ingredient_id, p_order_id, -(v_total_needed), 'ORDER_SERVED_DEDUCTION');
        RAISE NOTICE '[mark_order_served]   inventory_logs INSERT OK: %', v_ingredient_name;

        v_deductions := v_deductions || jsonb_build_array(jsonb_build_object(
            'ingredient_id',v_ingredient_id,'ingredient_name',v_ingredient_name,
            'unit',v_unit,'deducted',v_total_needed,
            'remaining_stock',ROUND((v_stock_level-v_total_needed)::NUMERIC,4)
        ));

        IF (v_stock_level - v_total_needed) <= v_low_stock_threshold THEN
            v_low_stock_alerts := v_low_stock_alerts || jsonb_build_array(jsonb_build_object(
                'ingredient_name',v_ingredient_name,'unit',v_unit,
                'new_stock_level',ROUND((v_stock_level-v_total_needed)::NUMERIC,4),
                'low_stock_threshold',v_low_stock_threshold
            ));
        END IF;
    END LOOP;

    RAISE NOTICE '[mark_order_served] COMPLETE — % deductions', jsonb_array_length(v_deductions);

    RETURN jsonb_build_object(
        'order_id',p_order_id,'menu_item_id',v_menu_item_id,
        'menu_item_name',v_menu_item_name,'quantity',v_quantity,
        'kitchen_status','served','deductions',v_deductions,
        'low_stock_alerts',v_low_stock_alerts
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_order_served(UUID)
    TO anon, authenticated, service_role;

-- mark_order_served recreated as SECURITY INVOKER and granted to all roles ✓


-- ============================================================================
-- STEP 6 — Recreate v_inventory_audit view + grant anon SELECT
-- ============================================================================
CREATE OR REPLACE VIEW public.v_inventory_audit AS
SELECT
    il.id            AS log_id,
    il.created_at,
    si.name          AS ingredient_name,
    si.unit,
    il.change_amount,
    si.stock_level   AS current_stock,
    il.reason,
    il.order_id,
    o.menu_item_id,
    mi.name          AS menu_item_name,
    o.quantity       AS order_quantity
FROM   public.inventory_logs il
JOIN   public.store_inventory si ON si.id = il.inventory_id
LEFT   JOIN public.orders o      ON o.id  = il.order_id
LEFT   JOIN public.menu_items mi ON mi.id = o.menu_item_id
ORDER  BY il.created_at DESC;

GRANT SELECT ON public.v_inventory_audit TO anon, authenticated, service_role;
-- v_inventory_audit view recreated and SELECT granted to all roles ✓


-- ============================================================================
-- STEP 7 — LIVE TEST: count rows in inventory_logs right now
-- ============================================================================
DO $$
DECLARE v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM public.inventory_logs;
    RAISE NOTICE 'inventory_logs row count = % (should be 0 if no orders served yet)', v_count;

    SELECT COUNT(*) INTO v_count FROM public.v_inventory_audit;
    RAISE NOTICE 'v_inventory_audit row count = %', v_count;
END;
$$;


-- ============================================================================
-- STEP 8 — LIVE END-TO-END TEST
-- Finds the most recent 'preparing' order and calls mark_order_served on it.
-- If no 'preparing' order exists, prints a safe notice and skips.
-- This WILL deduct stock and write audit rows — it's a real test.
-- Comment this block out if you don't want to trigger a real deduction.
-- ============================================================================
DO $$
DECLARE
    v_test_order_id   UUID;
    v_result          JSONB;
    v_deduction_count INT;
BEGIN
    -- Find the most recent 'preparing' order
    SELECT id INTO v_test_order_id
    FROM   public.orders
    WHERE  kitchen_status = 'preparing'
    ORDER  BY created_at DESC
    LIMIT  1;

    IF v_test_order_id IS NULL THEN
        RAISE NOTICE 'LIVE TEST: No preparing orders found. Place an order and accept it on the KDS, then re-run this block.';
        RAISE NOTICE 'LIVE TEST: Alternatively, find any NEW order UUID and manually update it:';
        RAISE NOTICE 'LIVE TEST:   UPDATE orders SET kitchen_status=''preparing'' WHERE id=''<uuid>'';';
        RAISE NOTICE 'LIVE TEST:   Then run: SELECT mark_order_served(''<uuid>''::UUID);';
    ELSE
        RAISE NOTICE 'LIVE TEST: Found preparing order %', v_test_order_id;
        RAISE NOTICE 'LIVE TEST: Calling mark_order_served...';

        v_result := public.mark_order_served(v_test_order_id);
        v_deduction_count := jsonb_array_length(v_result->'deductions');

        RAISE NOTICE 'LIVE TEST: Result = %', v_result;
        RAISE NOTICE 'LIVE TEST: Deductions written = %', v_deduction_count;

        IF v_deduction_count > 0 THEN
            RAISE NOTICE 'LIVE TEST: ✓ SUCCESS — inventory deducted and audit rows written!';
        ELSE
            RAISE NOTICE 'LIVE TEST: ⚠ No deductions — this menu item has no recipe. Check recipes table.';
        END IF;
    END IF;
END;
$$;


-- ============================================================================
-- STEP 9 — Show final state of inventory_logs
-- ============================================================================
SELECT
    il.id::TEXT          AS log_id,
    il.created_at::TEXT  AS created_at,
    si.name              AS ingredient,
    il.change_amount,
    il.reason,
    mi.name              AS menu_item
FROM   public.inventory_logs il
JOIN   public.store_inventory si ON si.id = il.inventory_id
LEFT   JOIN public.orders     o  ON o.id  = il.order_id
LEFT   JOIN public.menu_items mi ON mi.id = o.menu_item_id
ORDER  BY il.created_at DESC
LIMIT  20;
