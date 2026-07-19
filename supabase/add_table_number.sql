-- =============================================================================
-- Daris Hotel — Orders Table + place_order RPC (FULLY IDEMPOTENT)
-- Safe to paste and run in Supabase SQL Editor multiple times without errors.
-- =============================================================================


-- =============================================================================
-- STEP 1: Drop old function overloads to prevent signature ambiguity
-- =============================================================================
DROP FUNCTION IF EXISTS public.place_order(UUID, INT);
DROP FUNCTION IF EXISTS public.place_order(UUID, INT, INT);


-- =============================================================================
-- STEP 2: Drop and recreate the orders table (CASCADE removes dependent views)
-- =============================================================================
DROP TABLE IF EXISTS public.orders CASCADE;

CREATE TABLE public.orders (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    menu_item_id UUID        NOT NULL
                                REFERENCES public.menu_items(id)
                                ON DELETE RESTRICT,
    quantity     INT         NOT NULL CHECK (quantity > 0),
    table_number INT         NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.orders              IS 'Persistent record of every order placed via the API.';
COMMENT ON COLUMN public.orders.quantity     IS 'Number of servings ordered.';
COMMENT ON COLUMN public.orders.table_number IS 'Table number where the order was placed. Nullable.';

CREATE INDEX idx_orders_menu_item_id ON public.orders(menu_item_id);
CREATE INDEX idx_orders_created_at   ON public.orders(created_at DESC);


-- =============================================================================
-- STEP 3: Enable RLS and create policies (idempotent via DO $$ blocks)
-- =============================================================================
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'orders' AND policyname = 'orders: anon insert via rpc'
    ) THEN
        CREATE POLICY "orders: anon insert via rpc"
            ON public.orders FOR INSERT
            WITH CHECK (true);   -- Guarded by the SECURITY DEFINER function
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'orders' AND policyname = 'orders: authenticated read'
    ) THEN
        CREATE POLICY "orders: authenticated read"
            ON public.orders FOR SELECT
            TO authenticated
            USING (true);
    END IF;
END $$;


-- =============================================================================
-- STEP 4: CREATE OR REPLACE the place_order function
--         • Accepts p_table_number (optional, defaults to NULL)
--         • Recipe check is OPTIONAL — items without a recipe (e.g. drinks)
--           skip stock deduction and are ordered directly
-- =============================================================================
CREATE OR REPLACE FUNCTION public.place_order(
    p_menu_item_id  UUID,
    p_quantity      INT,
    p_table_number  INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ingredient_id       UUID;
    v_ingredient_name     TEXT;
    v_unit                TEXT;
    v_quantity_needed     FLOAT;
    v_stock_level         FLOAT;
    v_low_stock_threshold FLOAT;
    v_total_needed        FLOAT;

    v_order_id            UUID;
    v_order_created_at    TIMESTAMPTZ;
    v_menu_item_name      TEXT;
    v_has_recipe          BOOLEAN;
    v_has_shortage        BOOLEAN := FALSE;
    v_shortages           JSONB   := '[]'::JSONB;
    v_deductions          JSONB   := '[]'::JSONB;
    v_low_stock_alerts    JSONB   := '[]'::JSONB;
BEGIN
    -- ----------------------------------------------------------------
    -- Guard: menu item must exist
    -- ----------------------------------------------------------------
    SELECT name INTO v_menu_item_name
    FROM public.menu_items
    WHERE id = p_menu_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MENU_ITEM_NOT_FOUND: Menu item % does not exist.', p_menu_item_id
            USING ERRCODE = 'P0002';
    END IF;

    -- ----------------------------------------------------------------
    -- Optional recipe check
    -- ----------------------------------------------------------------
    SELECT EXISTS (
        SELECT 1 FROM public.recipes WHERE menu_item_id = p_menu_item_id
    ) INTO v_has_recipe;

    -- ================================================================
    -- Only run stock logic when the item has a recipe.
    -- Items without a recipe (drinks, etc.) skip to order insertion.
    -- ================================================================
    IF v_has_recipe THEN

        -- ------------------------------------------------------------
        -- PASS 1: Lock rows and collect any shortages
        -- ------------------------------------------------------------
        FOR v_ingredient_id, v_ingredient_name, v_unit,
            v_quantity_needed, v_stock_level, v_low_stock_threshold
        IN
            SELECT si.id, si.name, si.unit,
                   r.quantity_needed, si.stock_level, si.low_stock_threshold
            FROM   public.store_inventory si
            JOIN   public.recipes r ON r.ingredient_id = si.id
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

        -- Abort the entire transaction if any ingredient is short
        IF v_has_shortage THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: %', v_shortages::TEXT
                USING ERRCODE = 'P0001', DETAIL = v_shortages::TEXT;
        END IF;

        -- ------------------------------------------------------------
        -- PASS 2: Deduct stock (only reached when no shortages exist)
        -- ------------------------------------------------------------
        FOR v_ingredient_id, v_ingredient_name, v_unit,
            v_quantity_needed, v_stock_level, v_low_stock_threshold
        IN
            SELECT si.id, si.name, si.unit,
                   r.quantity_needed, si.stock_level, si.low_stock_threshold
            FROM   public.store_inventory si
            JOIN   public.recipes r ON r.ingredient_id = si.id
            WHERE  r.menu_item_id = p_menu_item_id
            ORDER  BY si.id
            FOR UPDATE OF si
        LOOP
            v_total_needed := v_quantity_needed * p_quantity;

            UPDATE public.store_inventory
            SET    stock_level = stock_level - v_total_needed
            WHERE  id = v_ingredient_id;

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
    -- ================================================================
    -- End of recipe-conditional block
    -- ================================================================

    -- ----------------------------------------------------------------
    -- PASS 3: Insert order record (always runs)
    -- ----------------------------------------------------------------
    INSERT INTO public.orders (menu_item_id, quantity, table_number)
    VALUES (p_menu_item_id, p_quantity, p_table_number)
    RETURNING id, created_at
    INTO v_order_id, v_order_created_at;

    -- ----------------------------------------------------------------
    -- Return result payload
    -- ----------------------------------------------------------------
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


-- =============================================================================
-- STEP 5: Grant execute permissions
-- =============================================================================
GRANT EXECUTE ON FUNCTION public.place_order(UUID, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_order(UUID, INT, INT) TO anon;

COMMENT ON FUNCTION public.place_order IS
'Atomic order placement (idempotent v3).
 - Validates menu item exists.
 - If item has a recipe: locks inventory, checks stock (aborts on shortage), deducts stock.
 - If item has no recipe (drinks etc.): skips stock logic, inserts order directly.
 - Stores table_number alongside the order.
 - Returns JSONB with order details, deductions, and low-stock alerts.';
