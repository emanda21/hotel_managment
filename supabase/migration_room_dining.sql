-- =============================================================================
-- Daris Hotel — Migration: In-Room Dining
-- =============================================================================
-- Version  : v6
-- Depends  : migration_fix_place_order_v5.sql must already be applied.
-- Safe to  : Run on a LIVE database. All ALTER TABLE steps use IF NOT EXISTS.
--            The DROP/CREATE of place_order is idempotent (dynamic overload drop).
--
-- What this migration does
-- ------------------------
-- 1. Adds two nullable columns to public.orders:
--      room_number           TEXT NULL  — hotel room number (in-room dining)
--      special_instructions  TEXT NULL  — guest prep notes for the kitchen
-- 2. Drops every existing overload of public.place_order (dynamic, safe).
-- 3. Creates the FINAL canonical 5-parameter function that:
--      a. Accepts p_room_number TEXT DEFAULT NULL
--      b. Accepts p_special_instructions TEXT DEFAULT NULL
--      c. Retains p_table_number INT DEFAULT NULL (backward-compat, dine-in)
--      d. Inserts all five fields into the orders row
--      e. Returns them in the JSONB payload
--      f. RETAINS ALL v5 logic:
--           - Menu-item existence guard
--           - Optional recipe check (items without a recipe skip stock logic)
--           - PASS 1: deadlock-safe FOR UPDATE lock + shortage accumulation
--           - Atomic abort on any shortage (RAISE EXCEPTION, full rollback)
--           - PASS 2: Insert order row (get order_id)
--           - PASS 3: stock deduction + inventory_logs audit row per ingredient
-- 4. Grants EXECUTE to anon and authenticated.
-- =============================================================================

BEGIN;

-- ============================================================================
-- STEP 1 — Add new columns to orders (idempotent)
-- ============================================================================
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS room_number          TEXT NULL;

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS special_instructions TEXT NULL;

COMMENT ON COLUMN public.orders.room_number IS
    'Hotel room number for in-room dining orders. NULL for dine-in / takeaway.';

COMMENT ON COLUMN public.orders.special_instructions IS
    'Optional guest preparation notes forwarded to the kitchen (e.g. "No onions").';


-- ============================================================================
-- STEP 2 — Drop ALL existing place_order overloads dynamically
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
-- STEP 3 — Create the canonical 5-parameter function
-- ============================================================================
CREATE FUNCTION public.place_order(
    p_menu_item_id          UUID,
    p_quantity              INT,
    p_table_number          INT   DEFAULT NULL,   -- kept for backward-compat (dine-in)
    p_room_number           TEXT  DEFAULT NULL,   -- NEW: in-room dining
    p_special_instructions  TEXT  DEFAULT NULL    -- NEW: guest prep notes
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

        IF v_has_shortage THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: %', v_shortages::TEXT
                USING ERRCODE = 'P0001',
                      DETAIL  = v_shortages::TEXT;
        END IF;

    END IF;
    -- End of PASS 1

    -- ================================================================
    -- PASS 2 — Insert order record (always runs)
    -- Now stores room_number and special_instructions.
    -- ================================================================
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
    INTO v_order_id, v_order_created_at;

    -- ================================================================
    -- PASS 3 — Deduct stock + write audit rows (only for recipe items)
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

            UPDATE public.store_inventory
            SET    stock_level = stock_level - v_total_needed
            WHERE  id = v_ingredient_id;

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

    END IF;
    -- End of PASS 3

    -- ================================================================
    -- Return the full result payload (now includes room + instructions)
    -- ================================================================
    RETURN jsonb_build_object(
        'order_id',             v_order_id,
        'menu_item_id',         p_menu_item_id,
        'menu_item_name',       v_menu_item_name,
        'quantity',             p_quantity,
        'table_number',         p_table_number,
        'room_number',          p_room_number,
        'special_instructions', p_special_instructions,
        'created_at',           v_order_created_at,
        'deductions',           v_deductions,
        'low_stock_alerts',     v_low_stock_alerts
    );

END;
$$;


-- ============================================================================
-- STEP 4 — Permissions
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.place_order(UUID, INT, INT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.place_order(UUID, INT, INT, TEXT, TEXT) TO authenticated;


-- ============================================================================
-- STEP 5 — Documentation
-- ============================================================================
COMMENT ON FUNCTION public.place_order(UUID, INT, INT, TEXT, TEXT) IS
'Atomic order placement — v6 (5-parameter signature, in-room dining support).

Parameters
----------
  p_menu_item_id         UUID      — The menu item being ordered (must exist).
  p_quantity             INT       — Number of servings (must be > 0).
  p_table_number         INT NULL  — Dine-in table number, or NULL for room service.
  p_room_number          TEXT NULL — Hotel room number for in-room delivery.
  p_special_instructions TEXT NULL — Guest preparation notes for the kitchen.

Logic
-----
  1. Validates menu item exists; raises MENU_ITEM_NOT_FOUND (P0002) if not.
  2. If the item has a recipe:
       PASS 1 — Row-locks store_inventory rows (ORDER BY id, deadlock-safe).
                Accumulates all shortages before aborting.
                Raises INSUFFICIENT_STOCK (P0001) + shortage JSONB on any deficit.
       PASS 2 — Inserts the orders row (obtains order_id), storing room_number
                and special_instructions alongside table_number.
       PASS 3 — Deducts stock_level + writes one inventory_logs row per ingredient.
  3. If the item has NO recipe: skips stock logic; goes straight to orders INSERT.
  4. Returns JSONB: order_id, menu_item_id, menu_item_name, quantity,
     table_number, room_number, special_instructions, created_at,
     deductions[], low_stock_alerts[].

All writes are inside one PostgreSQL transaction — any failure causes a
complete rollback (no partial stock deductions, no orphan order rows).';


-- ============================================================================
-- STEP 6 — Verification queries
-- ============================================================================
-- 1. Confirm new columns exist:
-- SELECT column_name, data_type, is_nullable
-- FROM   information_schema.columns
-- WHERE  table_schema = 'public' AND table_name = 'orders'
-- AND    column_name IN ('room_number', 'special_instructions');
--
-- 2. Confirm the 5-parameter function exists:
-- SELECT p.proname, pg_get_function_arguments(p.oid) AS args
-- FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE  n.nspname = 'public' AND p.proname = 'place_order';
--
-- 3. Confirm EXECUTE grants:
-- SELECT grantee, privilege_type
-- FROM   information_schema.routine_privileges
-- WHERE  routine_schema = 'public' AND routine_name = 'place_order';

COMMIT;
