-- =============================================================================
-- Daris Hotel — Migration: Fix place_order signature (add p_table_number)
-- =============================================================================
-- Version  : v5
-- Depends  : migration_recipe_audit.sql (v3/v4) must already be applied.
-- Safe to  : Run on a LIVE database. Idempotent — uses the same dynamic DROP
--            technique that migration_recipe_audit.sql uses itself.
--
-- Root cause
-- ----------
-- migration_recipe_audit.sql (v3) intentionally dropped ALL overloads of
-- public.place_order and recreated it with only 2 parameters:
--     place_order(p_menu_item_id UUID, p_quantity INT)
-- This silently reverted the 3-parameter version that add_table_number.sql
-- had previously established:
--     place_order(p_menu_item_id UUID, p_quantity INT, p_table_number INT)
-- The frontend now sends 3 arguments, causing PGRST202 ("function not found
-- in schema cache — perhaps you meant the 2-argument overload").
--
-- What this migration does
-- ------------------------
-- 1. Drops every existing overload of public.place_order (dynamic, safe).
-- 2. Creates the FINAL canonical 3-parameter function that:
--    a. Accepts p_table_number INT DEFAULT NULL (matches orders.table_number)
--    b. Inserts table_number into the orders row
--    c. Retains ALL v3 logic:
--       - Menu-item existence guard
--       - Optional recipe check (items without a recipe skip stock logic)
--       - PASS 1: deadlock-safe FOR UPDATE lock + shortage accumulation
--       - Atomic abort on any shortage (RAISE EXCEPTION, full rollback)
--       - PASS 2: stock deduction + inventory_logs audit row per ingredient
--    d. Returns the full JSONB payload including table_number
-- 3. Grants EXECUTE to both `authenticated` and `anon` roles.
-- =============================================================================

BEGIN;

-- ============================================================================
-- STEP 1 — Drop ALL existing place_order overloads dynamically
-- ============================================================================
-- This mirrors the technique in migration_recipe_audit.sql (lines 226-241).
-- It discovers every overload via pg_proc so there is no hardcoded signature
-- to keep in sync.
-- ============================================================================
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
        RAISE NOTICE 'Dropped overload: %', r.drop_target;
    END LOOP;
END;
$$;


-- ============================================================================
-- STEP 2 — Create the canonical 3-parameter function
-- ============================================================================
-- Data-type alignment:
--   orders.table_number  →  INT NULL   (defined in add_table_number.sql)
--   p_table_number       →  INT DEFAULT NULL   ✓ exact match
-- ============================================================================
CREATE FUNCTION public.place_order(
    p_menu_item_id  UUID,
    p_quantity      INT,
    p_table_number  INT  DEFAULT NULL   -- nullable, matches orders.table_number
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    -- Ingredient loop variables
    v_ingredient_id       UUID;
    v_ingredient_name     TEXT;
    v_unit                TEXT;
    v_quantity_needed     FLOAT;
    v_stock_level         FLOAT;
    v_low_stock_threshold FLOAT;
    v_total_needed        FLOAT;

    -- Order record
    v_order_id            UUID;
    v_order_created_at    TIMESTAMPTZ;
    v_menu_item_name      TEXT;

    -- Control flags
    v_has_recipe          BOOLEAN;
    v_has_shortage        BOOLEAN := FALSE;

    -- Result accumulators
    v_shortages           JSONB   := '[]'::JSONB;
    v_deductions          JSONB   := '[]'::JSONB;
    v_low_stock_alerts    JSONB   := '[]'::JSONB;
BEGIN

    -- ================================================================
    -- GUARD: menu item must exist
    -- ================================================================
    SELECT name INTO v_menu_item_name
    FROM   public.menu_items
    WHERE  id = p_menu_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MENU_ITEM_NOT_FOUND: Menu item % does not exist.', p_menu_item_id
            USING ERRCODE = 'P0002';
    END IF;

    -- ================================================================
    -- Optional recipe check
    -- Items without a recipe (drinks, pre-packaged goods, etc.) skip
    -- the stock-deduction block entirely and go straight to the INSERT.
    -- ================================================================
    SELECT EXISTS (
        SELECT 1 FROM public.recipes WHERE menu_item_id = p_menu_item_id
    ) INTO v_has_recipe;

    -- ================================================================
    -- PASS 1 — Stock check (only when the item has a recipe)
    --
    --  FOR UPDATE OF si acquires a row-level lock on each store_inventory
    --  row touched by this order.  ORDER BY si.id prevents deadlocks when
    --  two concurrent orders share ingredients.
    --  All locks are held until the transaction commits or rolls back, so
    --  the check-then-deduct is race-condition-free.
    -- ================================================================
    IF v_has_recipe THEN

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
            WHERE  r.menu_item_id = p_menu_item_id
            ORDER  BY si.id
            FOR UPDATE OF si
        LOOP
            v_total_needed := v_quantity_needed * p_quantity;

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

        -- Abort and roll back the ENTIRE transaction on any shortage.
        -- The client receives the shortages array in the error DETAIL.
        IF v_has_shortage THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: %', v_shortages::TEXT
                USING ERRCODE = 'P0001',
                      DETAIL  = v_shortages::TEXT;
        END IF;

    END IF;
    -- End of PASS 1

    -- ================================================================
    -- PASS 2 — Insert order record (always runs — with or without recipe)
    --
    --  Done BEFORE stock deduction so that v_order_id is available as a
    --  foreign key in the inventory_logs rows written in PASS 3.
    --  table_number is stored here (NULL-safe).
    -- ================================================================
    INSERT INTO public.orders (menu_item_id, quantity, table_number)
    VALUES (p_menu_item_id, p_quantity, p_table_number)
    RETURNING id, created_at
    INTO v_order_id, v_order_created_at;

    -- ================================================================
    -- PASS 3 — Deduct stock + write audit rows (only for recipe items)
    --
    --  Rows are still locked from PASS 1.  The UPDATE + INSERT pair is
    --  inside the same transaction — if either fails, both roll back.
    -- ================================================================
    IF v_has_recipe THEN

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
            WHERE  r.menu_item_id = p_menu_item_id
            ORDER  BY si.id
            FOR UPDATE OF si
        LOOP
            v_total_needed := v_quantity_needed * p_quantity;

            -- Deduct from store_inventory
            UPDATE public.store_inventory
            SET    stock_level = stock_level - v_total_needed
            WHERE  id = v_ingredient_id;

            -- Append to the audit log (negative change_amount = consumed)
            INSERT INTO public.inventory_logs (
                inventory_id,
                order_id,
                change_amount,
                reason
            ) VALUES (
                v_ingredient_id,
                v_order_id,
                -(v_total_needed),
                'ORDER_DEDUCTION'
            );

            -- Build the deductions array for the response payload
            v_deductions := v_deductions || jsonb_build_array(
                jsonb_build_object(
                    'ingredient_id',   v_ingredient_id,
                    'ingredient_name', v_ingredient_name,
                    'unit',            v_unit,
                    'deducted',        v_total_needed,
                    'remaining_stock', ROUND((v_stock_level - v_total_needed)::NUMERIC, 4)
                )
            );

            -- Collect low-stock alert if stock fell to / below threshold
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

    END IF;
    -- End of PASS 3

    -- ================================================================
    -- Return the full result payload
    -- ================================================================
    RETURN jsonb_build_object(
        'order_id',         v_order_id,
        'menu_item_id',     p_menu_item_id,
        'menu_item_name',   v_menu_item_name,
        'quantity',         p_quantity,
        'table_number',     p_table_number,
        'created_at',       v_order_created_at,
        'deductions',       v_deductions,
        'low_stock_alerts', v_low_stock_alerts
    );

END;
$$;


-- ============================================================================
-- STEP 3 — Permissions
-- ============================================================================
-- `anon`  : allows unauthenticated customers on the menu page to place orders.
-- `authenticated` : admin staff / kitchen displays.
-- The SECURITY DEFINER attribute means the function always runs with the
-- privileges of the function owner (your Supabase service role), regardless
-- of which role calls it — ensuring it can write to orders and inventory_logs
-- even when called by the anon role.
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.place_order(UUID, INT, INT) TO anon;
GRANT EXECUTE ON FUNCTION public.place_order(UUID, INT, INT) TO authenticated;


-- ============================================================================
-- STEP 4 — Documentation
-- ============================================================================
COMMENT ON FUNCTION public.place_order(UUID, INT, INT) IS
'Atomic order placement — v5 (canonical 3-parameter signature).

Parameters
----------
  p_menu_item_id  UUID     — The menu item being ordered (must exist).
  p_quantity      INT      — Number of servings (must be > 0).
  p_table_number  INT NULL — Dine-in table number, or NULL for take-away.

Logic
-----
  1. Validates menu item exists; raises MENU_ITEM_NOT_FOUND (P0002) if not.
  2. If the item has a recipe:
       PASS 1 — Row-locks store_inventory rows (ORDER BY id, deadlock-safe).
                Accumulates all shortages before aborting.
                Raises INSUFFICIENT_STOCK (P0001) + shortage JSONB on any deficit.
       PASS 2 — Inserts the orders row (obtains order_id).
       PASS 3 — Deducts stock_level + writes one inventory_logs row per ingredient.
  3. If the item has NO recipe (drinks, pre-packaged items):
       Skips stock logic entirely; goes straight to the orders INSERT.
  4. Returns JSONB: order_id, menu_item_id, menu_item_name, quantity,
     table_number, created_at, deductions[], low_stock_alerts[].

All writes are inside one PostgreSQL transaction — any failure causes a
complete rollback (no partial stock deductions, no orphan order rows).';


-- ============================================================================
-- STEP 5 — Verification queries  (run after applying to confirm correctness)
-- ============================================================================
-- 1. Confirm the function exists with exactly the right 3-parameter signature:
--
-- SELECT p.proname,
--        pg_get_function_arguments(p.oid) AS args,
--        pg_get_function_result(p.oid)    AS returns
-- FROM   pg_proc     p
-- JOIN   pg_namespace n ON n.oid = p.pronamespace
-- WHERE  n.nspname = 'public'
-- AND    p.proname = 'place_order';
--
-- Expected output:
--   proname     | args                                              | returns
--   place_order | p_menu_item_id uuid, p_quantity int, p_table_number int | jsonb
--
-- 2. Confirm EXECUTE permission on anon:
--
-- SELECT grantee, privilege_type
-- FROM   information_schema.routine_privileges
-- WHERE  routine_schema = 'public'
-- AND    routine_name   = 'place_order';
--
-- Expected: rows for anon and authenticated both showing EXECUTE.

COMMIT;
