-- =============================================================================
-- Daris Hotel — Atomic Order Placement RPC
-- =============================================================================
-- Run this in Supabase Dashboard → SQL Editor AFTER schema.sql has been run.
--
-- What this script does:
--   1. Creates the `orders` table to persist order history.
--   2. Creates the `place_order` PostgreSQL function that runs entirely inside
--      a single implicit transaction.  If ANY step fails (stock shortage, DB
--      error, etc.) the entire operation is rolled back automatically.
-- =============================================================================


-- =============================================================================
-- TABLE: orders
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.orders (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    menu_item_id UUID        NOT NULL
                                REFERENCES public.menu_items(id)
                                ON DELETE RESTRICT,   -- preserve history
    quantity     INT         NOT NULL CHECK (quantity > 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.orders          IS 'Persistent record of every order placed via the API.';
COMMENT ON COLUMN public.orders.quantity IS 'Number of servings ordered in this line.';

CREATE INDEX IF NOT EXISTS idx_orders_menu_item_id ON public.orders(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at   ON public.orders(created_at DESC);

-- RLS: staff read/write, no customer access to order history
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view orders"
    ON public.orders FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff can insert orders"
    ON public.orders FOR INSERT TO authenticated WITH CHECK (true);


-- =============================================================================
-- FUNCTION: place_order(p_menu_item_id, p_quantity)
-- =============================================================================
-- This is a SECURITY DEFINER function — it runs with the privileges of the
-- function owner (service role), so RLS does not block internal writes.
--
-- Error codes raised:
--   P0001  INSUFFICIENT_STOCK   — one or more ingredients are out of stock
--   P0002  MENU_ITEM_NOT_FOUND  — the requested menu item UUID does not exist
--   P0003  NO_RECIPE_FOUND      — menu item has no recipe configured
--
-- Returns JSONB with shape:
--   {
--     "order_id":         "<uuid>",
--     "menu_item_id":     "<uuid>",
--     "menu_item_name":   "<string>",
--     "quantity":         <int>,
--     "created_at":       "<timestamptz>",
--     "deductions": [
--       {
--         "ingredient_id":   "<uuid>",
--         "ingredient_name": "<string>",
--         "unit":            "<string>",
--         "deducted":        <float>,
--         "remaining_stock": <float>
--       }, ...
--     ],
--     "low_stock_alerts": [
--       {
--         "ingredient_name":    "<string>",
--         "unit":               "<string>",
--         "new_stock_level":    <float>,
--         "low_stock_threshold":<float>
--       }, ...
--     ]
--   }
-- =============================================================================

CREATE OR REPLACE FUNCTION public.place_order(
    p_menu_item_id  UUID,
    p_quantity      INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    -- Cursor variables for the recipe loop
    v_ingredient_id      UUID;
    v_ingredient_name    TEXT;
    v_unit               TEXT;
    v_quantity_needed    FLOAT;
    v_stock_level        FLOAT;
    v_low_stock_threshold FLOAT;
    v_total_needed       FLOAT;

    -- Result accumulators
    v_order_id           UUID;
    v_order_created_at   TIMESTAMPTZ;
    v_menu_item_name     TEXT;
    v_has_shortage       BOOLEAN := FALSE;
    v_shortages          JSONB   := '[]'::JSONB;
    v_deductions         JSONB   := '[]'::JSONB;
    v_low_stock_alerts   JSONB   := '[]'::JSONB;
BEGIN
    -- ----------------------------------------------------------------
    -- Guard: validate menu item exists
    -- ----------------------------------------------------------------
    SELECT name INTO v_menu_item_name
    FROM public.menu_items
    WHERE id = p_menu_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MENU_ITEM_NOT_FOUND: Menu item % does not exist.', p_menu_item_id
            USING ERRCODE = 'P0002';
    END IF;

    -- ----------------------------------------------------------------
    -- Guard: validate a recipe exists for this menu item
    -- ----------------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM public.recipes WHERE menu_item_id = p_menu_item_id
    ) THEN
        RAISE EXCEPTION 'NO_RECIPE_FOUND: No recipe is configured for menu item % (%).', v_menu_item_name, p_menu_item_id
            USING ERRCODE = 'P0003';
    END IF;

    -- ----------------------------------------------------------------
    -- PASS 1 — Lock inventory rows (ORDER BY id prevents deadlocks)
    --           and collect shortage information.
    --
    --   FOR UPDATE OF si acquires a row-level lock on each matching
    --   store_inventory row.  No other concurrent transaction can
    --   modify these rows until our transaction commits or rolls back,
    --   which makes the check-then-update race-condition-free.
    -- ----------------------------------------------------------------
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
        ORDER  BY si.id                  -- deterministic lock order
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

    -- Abort and roll back the entire transaction if ANY ingredient is short.
    -- The RAISE causes PostgreSQL to automatically roll back everything done
    -- so far in this function call (the locks are released too).
    IF v_has_shortage THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: %', v_shortages::TEXT
            USING ERRCODE = 'P0001',
                  DETAIL  = v_shortages::TEXT;
    END IF;

    -- ----------------------------------------------------------------
    -- PASS 2 — Deduct stock.
    --   Rows are already locked from Pass 1 so no re-lock needed, but
    --   FOR UPDATE is safe to repeat within the same transaction.
    -- ----------------------------------------------------------------
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

        -- Perform the stock deduction
        UPDATE public.store_inventory
        SET    stock_level = stock_level - v_total_needed
        WHERE  id = v_ingredient_id;

        -- Record the deduction for the response payload
        v_deductions := v_deductions || jsonb_build_array(
            jsonb_build_object(
                'ingredient_id',   v_ingredient_id,
                'ingredient_name', v_ingredient_name,
                'unit',            v_unit,
                'deducted',        v_total_needed,
                'remaining_stock', ROUND((v_stock_level - v_total_needed)::NUMERIC, 4)
            )
        );

        -- Collect low-stock alert if new level <= threshold
        IF (v_stock_level - v_total_needed) <= v_low_stock_threshold THEN
            v_low_stock_alerts := v_low_stock_alerts || jsonb_build_array(
                jsonb_build_object(
                    'ingredient_name',    v_ingredient_name,
                    'unit',               v_unit,
                    'new_stock_level',    ROUND((v_stock_level - v_total_needed)::NUMERIC, 4),
                    'low_stock_threshold', v_low_stock_threshold
                )
            );
        END IF;
    END LOOP;

    -- ----------------------------------------------------------------
    -- PASS 3 — Insert the order record.
    --   If this INSERT fails for any reason, PostgreSQL will roll back
    --   both the order insert AND all the stock deductions above.
    -- ----------------------------------------------------------------
    INSERT INTO public.orders (menu_item_id, quantity)
    VALUES (p_menu_item_id, p_quantity)
    RETURNING id, created_at
    INTO v_order_id, v_order_created_at;

    -- ----------------------------------------------------------------
    -- Return the full result payload
    -- ----------------------------------------------------------------
    RETURN jsonb_build_object(
        'order_id',         v_order_id,
        'menu_item_id',     p_menu_item_id,
        'menu_item_name',   v_menu_item_name,
        'quantity',         p_quantity,
        'created_at',       v_order_created_at,
        'deductions',       v_deductions,
        'low_stock_alerts', v_low_stock_alerts
    );

END;
$$;

-- Grant execute permission to authenticated users (the service-role key
-- can always call it; this grant enables calls from anon/authenticated roles
-- if you ever want to allow direct client-side ordering in the future).
GRANT EXECUTE ON FUNCTION public.place_order(UUID, INT) TO authenticated;

COMMENT ON FUNCTION public.place_order IS
'Atomic order placement: validates stock, locks inventory rows, deducts stock,
 inserts the order — all in one PostgreSQL transaction.
 Returns a JSONB payload with the order details, per-ingredient deductions,
 and any low-stock alerts triggered by the deduction.';
