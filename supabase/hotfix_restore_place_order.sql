-- =============================================================================
-- Daris Hotel — HOTFIX: Restore place_order with p_waiter_id (v8 restore)
-- =============================================================================
-- PROBLEM:
--   migration_deferred_deduction.sql (v7) was run AFTER
--   migration_waiter_and_deduction_fix.sql (v8) and dropped the 6-parameter
--   version of place_order, recreating it with only 5 params (no p_waiter_id).
--
--   The frontend + backend both pass p_waiter_id, so EVERY order placement
--   fails with PGRST202 "function not found".
--
-- FIX:
--   Drop the broken 5-param version and recreate the correct 6-param version.
--   This is identical to migration_waiter_and_deduction_fix.sql Part B,
--   but now uses SECURITY INVOKER so RLS bypass flows correctly for service_role.
-- =============================================================================

-- Step 1: Drop ALL existing overloads of place_order
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure::TEXT AS sig
        FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE  n.nspname = 'public' AND p.proname = 'place_order'
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
        RAISE NOTICE 'Dropped: %', r.sig;
    END LOOP;
END;
$$;


-- Step 2: Recreate place_order with ALL 6 parameters (including p_waiter_id)
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
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_menu_item_name  TEXT;
    v_order_id        UUID;
    v_created_at      TIMESTAMPTZ;
BEGIN
    -- Guard: menu item must exist
    SELECT name INTO v_menu_item_name
    FROM   public.menu_items
    WHERE  id = p_menu_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MENU_ITEM_NOT_FOUND: Menu item % does not exist.', p_menu_item_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Insert order row (stock deduction happens later via mark_order_served)
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

GRANT EXECUTE ON FUNCTION public.place_order(UUID, INT, INT, TEXT, TEXT, TEXT)
    TO anon, authenticated, service_role;

-- Step 3: Confirm both functions now exist with correct signatures
SELECT
    p.proname                               AS function_name,
    pg_get_function_arguments(p.oid)        AS parameters,
    CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
AND    p.proname IN ('place_order', 'mark_order_served')
ORDER  BY p.proname;
