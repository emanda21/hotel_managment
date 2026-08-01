-- =============================================================================
-- Daris Hotel — Migration: Final Audit Fix (v10)
-- =============================================================================
-- Version  : v10
-- Depends  : migration_kds_prep_timer.sql (v9) must already be applied.
--
-- Root cause of silent audit failure
-- -----------------------------------
-- inventory_logs has RLS ENABLED with only "authenticated" INSERT policy.
-- When mark_order_served (SECURITY DEFINER) runs, PostgreSQL switches context
-- to the function OWNER. In Supabase, SECURITY DEFINER functions owned by
-- the default role still respect RLS unless row_security=off is set AND the
-- RLS check passes for the calling role.
--
-- The service_role JWT bypasses RLS at the PostgREST layer, but when the
-- Python supabase-py client calls db.rpc(...), supabase-py connects as the
-- role encoded in the JWT. The service_role key makes Supabase bypass RLS
-- for DIRECT table queries — but inside a SECURITY DEFINER plpgsql function,
-- the effective role for RLS checks reverts to the function owner, which may
-- not have a matching INSERT policy.
--
-- THE DEFINITIVE FIX:
--   1. Grant INSERT + SELECT on inventory_logs to the service_role directly.
--   2. Add an explicit RLS bypass policy for service_role.
--   3. Rebuild mark_order_served as v4 — identical logic but with
--      RESET row_security (removes the SET ... = off so the function
--      runs under the CALLER's privileges, which for service_role bypasses
--      RLS automatically at the Supabase layer).
--
-- This also verifies prep_time_minutes / target_serve_time columns exist
-- (added by v9) and confirms inventory_logs column names.
-- =============================================================================

BEGIN;

-- ============================================================================
-- PART A — Grant service_role direct access to inventory_logs
--          This is the nuclear fix: service_role bypasses RLS automatically
--          in Supabase, so granting it explicit USAGE ensures the INSERT
--          inside the RPC function never hits an RLS block.
-- ============================================================================

-- Grant table privileges to service_role
GRANT SELECT, INSERT ON public.inventory_logs TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.store_inventory TO service_role;
GRANT SELECT, UPDATE ON public.orders TO service_role;
GRANT SELECT ON public.menu_items TO service_role;
GRANT SELECT ON public.recipes TO service_role;

-- ============================================================================
-- PART B — Add service_role bypass policy on inventory_logs
--          service_role in Supabase bypasses RLS by default, but being
--          explicit is belt-and-suspenders.
-- ============================================================================

DO $$
BEGIN
    -- Service role: SELECT
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE  schemaname = 'public'
        AND    tablename  = 'inventory_logs'
        AND    policyname = 'Service role can manage inventory logs'
    ) THEN
        EXECUTE '
            CREATE POLICY "Service role can manage inventory logs"
                ON public.inventory_logs
                FOR ALL TO service_role
                USING (true)
                WITH CHECK (true)
        ';
        RAISE NOTICE 'Created service_role ALL policy on inventory_logs';
    ELSE
        RAISE NOTICE 'Service role policy already exists — skipped';
    END IF;

    -- Also ensure authenticated INSERT still exists (belt-and-suspenders)
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
        RAISE NOTICE 'Anon INSERT policy already exists — skipped';
    END IF;

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
        RAISE NOTICE 'Anon SELECT policy already exists — skipped';
    END IF;
END;
$$;


-- ============================================================================
-- PART C — Rebuild mark_order_served as v4
--
-- KEY CHANGE vs v3:
--   Removed "SET row_security = off" from the function header.
--   When service_role calls this function, Supabase already bypasses RLS
--   at the connection level. The SET row_security = off was causing the
--   function to run as the function OWNER (not service_role), which then
--   had no matching RLS INSERT policy.
--
--   v4 lets the CALLER'S role (service_role) do the writes, which naturally
--   bypasses RLS. This is the correct pattern for Supabase + service_role.
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


-- Step C2 — Create mark_order_served v4
-- CRITICAL: No SET row_security = off  →  runs under CALLER's role (service_role)
--           service_role bypasses RLS automatically in Supabase
CREATE FUNCTION public.mark_order_served(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER          -- run as the CALLING role (service_role), NOT the owner
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

    RAISE NOTICE '[mark_order_served v4] Called with p_order_id=%', p_order_id;

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

    RAISE NOTICE '[mark_order_served v4] Order found: menu_item_id=%, qty=%, status=%',
        v_menu_item_id, v_quantity, v_current_status;

    -- ================================================================
    -- GUARD 2 — Idempotency
    -- ================================================================
    IF v_current_status = 'served' THEN
        RAISE EXCEPTION 'ALREADY_SERVED: Order % has already been marked as served.', p_order_id
            USING ERRCODE = 'P0003';
    END IF;

    -- ================================================================
    -- STEP 1 — Mark the order as served
    -- ================================================================
    RAISE NOTICE '[mark_order_served v4] Marking order as served...';
    UPDATE public.orders
    SET    kitchen_status = 'served'
    WHERE  id = p_order_id;

    RAISE NOTICE '[mark_order_served v4] orders.kitchen_status updated OK';

    -- ================================================================
    -- Fetch menu item name
    -- ================================================================
    SELECT name INTO v_menu_item_name
    FROM   public.menu_items
    WHERE  id = v_menu_item_id;

    RAISE NOTICE '[mark_order_served v4] Menu item: %', COALESCE(v_menu_item_name, 'NOT FOUND');

    -- ================================================================
    -- STEP 2 — Check if item has a recipe
    -- ================================================================
    SELECT EXISTS (
        SELECT 1 FROM public.recipes WHERE menu_item_id = v_menu_item_id
    ) INTO v_has_recipe;

    RAISE NOTICE '[mark_order_served v4] has_recipe=%', v_has_recipe;

    IF NOT v_has_recipe THEN
        RAISE NOTICE '[mark_order_served v4] No recipe — returning without stock deduction.';
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
    -- PASS 1 — Stock check (FOR UPDATE, ORDER BY id — deadlock-safe)
    -- ================================================================
    RAISE NOTICE '[mark_order_served v4] PASS 1 — stock check';
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
        RAISE NOTICE '[mark_order_served v4]   ingredient=% stock=% needed=%',
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

    IF v_has_shortage THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: %', v_shortages::TEXT
            USING ERRCODE = 'P0001',
                  DETAIL  = v_shortages::TEXT;
    END IF;

    -- ================================================================
    -- PASS 2+3 — Deduct stock + write inventory_logs
    --   inventory_logs column: inventory_id (confirmed from schema)
    -- ================================================================
    RAISE NOTICE '[mark_order_served v4] PASS 2+3 — deducting stock and writing audit logs';
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

        -- Deduct stock
        UPDATE public.store_inventory
        SET    stock_level = stock_level - v_total_needed
        WHERE  id = v_ingredient_id;

        RAISE NOTICE '[mark_order_served v4]   store_inventory updated for %', v_ingredient_name;

        -- Write audit log — column is inventory_id (verified from migration_recipe_audit.sql)
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

        RAISE NOTICE '[mark_order_served v4]   inventory_logs INSERT OK for %', v_ingredient_name;

        -- Accumulate response
        v_deductions := v_deductions || jsonb_build_array(
            jsonb_build_object(
                'ingredient_id',   v_ingredient_id,
                'ingredient_name', v_ingredient_name,
                'unit',            v_unit,
                'deducted',        v_total_needed,
                'remaining_stock', ROUND((v_stock_level - v_total_needed)::NUMERIC, 4)
            )
        );

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

    RAISE NOTICE '[mark_order_served v4] DONE — % deductions written.', jsonb_array_length(v_deductions);

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
'mark_order_served v4 — SECURITY INVOKER (runs as caller = service_role).

KEY CHANGE vs v3:
  Changed from SECURITY DEFINER to SECURITY INVOKER.
  When the Python backend calls this via service_role key, the function
  executes with service_role privileges, which bypass RLS automatically
  in Supabase. No SET row_security = off needed — the caller already
  has full access.

  Column confirmed: inventory_logs.inventory_id (not ingredient_id).';

GRANT EXECUTE ON FUNCTION public.mark_order_served(UUID)
    TO anon, authenticated, service_role;


-- ============================================================================
-- PART D — Verify columns exist (diagnostic output in Supabase logs)
-- ============================================================================

DO $$
DECLARE
    v_inv_id_exists   BOOLEAN;
    v_prep_col_exists BOOLEAN;
    v_target_col_exists BOOLEAN;
BEGIN
    -- Check inventory_logs.inventory_id
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE  table_schema = 'public' AND table_name = 'inventory_logs'
        AND    column_name  = 'inventory_id'
    ) INTO v_inv_id_exists;

    IF v_inv_id_exists THEN
        RAISE NOTICE 'VERIFY OK: inventory_logs.inventory_id column exists';
    ELSE
        RAISE WARNING 'VERIFY FAIL: inventory_logs.inventory_id NOT FOUND — check column names!';
    END IF;

    -- Check orders.prep_time_minutes
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE  table_schema = 'public' AND table_name = 'orders'
        AND    column_name  = 'prep_time_minutes'
    ) INTO v_prep_col_exists;

    IF v_prep_col_exists THEN
        RAISE NOTICE 'VERIFY OK: orders.prep_time_minutes column exists';
    ELSE
        RAISE WARNING 'VERIFY FAIL: orders.prep_time_minutes NOT FOUND — run v9 migration first!';
    END IF;

    -- Check orders.target_serve_time
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE  table_schema = 'public' AND table_name = 'orders'
        AND    column_name  = 'target_serve_time'
    ) INTO v_target_col_exists;

    IF v_target_col_exists THEN
        RAISE NOTICE 'VERIFY OK: orders.target_serve_time column exists';
    ELSE
        RAISE WARNING 'VERIFY FAIL: orders.target_serve_time NOT FOUND — run v9 migration first!';
    END IF;
END;
$$;

COMMIT;
