-- =============================================================================
-- Daris Hotel — Migration: Recipe Audit & Inventory Logs
-- =============================================================================
-- Version  : v3
-- Depends  : schema.sql + place_order_rpc.sql must already be applied.
-- Safe to  : Run on a LIVE database. Uses CREATE TABLE IF NOT EXISTS and
--            idempotent policy guards. Does NOT drop any existing table.
--
-- What this migration adds:
--   1. Verifies the existing `recipes` table structure.
--   2. Creates the `inventory_logs` audit table with FK constraints to
--      `store_inventory` and `orders`.
--   3. Applies RLS policies to `inventory_logs`.
--   4. Replaces the `place_order` RPC to emit one `inventory_logs` row per
--      ingredient deduction inside the same atomic transaction.
--   5. Creates a convenience view `v_inventory_audit`.
-- =============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1 — Confirm uuid-ossp is available (idempotent, safe to re-run)
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================================================
-- SECTION 2 — Verify `recipes` table (informational guard)
-- ============================================================================
-- The `recipes` table already satisfies the requested design:
--
--   recipes.menu_item_id  -> menu_items.id      (FK, ON DELETE CASCADE)
--   recipes.ingredient_id -> store_inventory.id  (FK, ON DELETE CASCADE)
--   recipes.quantity_needed FLOAT NOT NULL CHECK (quantity_needed > 0)
--   UNIQUE (menu_item_id, ingredient_id)
--
-- No structural changes required. The DO block below raises an EXCEPTION if
-- the table somehow does not exist so the DBA is alerted before continuing.
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   information_schema.tables
        WHERE  table_schema = 'public'
        AND    table_name   = 'recipes'
    ) THEN
        RAISE EXCEPTION
            'MIGRATION ABORTED: public.recipes does not exist. '
            'Run schema.sql before applying this migration.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM   information_schema.columns
        WHERE  table_schema  = 'public'
        AND    table_name    = 'recipes'
        AND    column_name   = 'quantity_needed'
    ) THEN
        RAISE EXCEPTION
            'MIGRATION ABORTED: public.recipes.quantity_needed column not found. '
            'Schema version mismatch - check schema.sql.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM   information_schema.columns
        WHERE  table_schema  = 'public'
        AND    table_name    = 'recipes'
        AND    column_name   = 'ingredient_id'
    ) THEN
        RAISE EXCEPTION
            'MIGRATION ABORTED: public.recipes.ingredient_id column not found. '
            'Schema version mismatch - check schema.sql.';
    END IF;

    RAISE NOTICE 'recipes table verified OK: menu_item_id FK, ingredient_id FK, quantity_needed column all present.';
END;
$$;


-- ============================================================================
-- SECTION 3 — TABLE: inventory_logs  (Audit trail)
-- ============================================================================
-- Every time an order deducts stock from store_inventory, one row is written
-- here. The row is written INSIDE the same transaction as the deduction, so
-- it rolls back automatically if the order fails for any reason.
--
-- Columns:
--   id            - surrogate PK
--   inventory_id  - FK -> store_inventory.id (which ingredient was touched)
--   order_id      - FK -> orders.id          (which order caused the deduction)
--                   NULL allowed: future manual adjustments won't have an order
--   change_amount - signed FLOAT; negative = deduction, positive = restock
--   reason        - free-text description (e.g. ORDER_DEDUCTION, MANUAL_RESTOCK)
--   created_at    - wall-clock timestamp, defaults to NOW()
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_logs (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),

    inventory_id  UUID        NOT NULL
                                REFERENCES public.store_inventory(id)
                                ON DELETE RESTRICT,
                                -- Keep audit rows even if the ingredient is
                                -- deleted. Force explicit cleanup by the DBA.

    order_id      UUID        NULL
                                REFERENCES public.orders(id)
                                ON DELETE SET NULL,
                                -- If the order record is ever purged, keep the
                                -- log row but clear the FK reference.

    change_amount FLOAT       NOT NULL,
    -- Negative  = stock consumed (order deduction, waste write-off)
    -- Positive  = stock added    (manual restock, correction)

    reason        TEXT        NOT NULL DEFAULT 'ORDER_DEDUCTION',
    -- Suggested values: ORDER_DEDUCTION | MANUAL_RESTOCK | WASTE_WRITE_OFF

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.inventory_logs
    IS 'Immutable audit trail of every stock change. One row per ingredient per order.';
COMMENT ON COLUMN public.inventory_logs.inventory_id
    IS 'The store_inventory row that was modified.';
COMMENT ON COLUMN public.inventory_logs.order_id
    IS 'The order that triggered this change, NULL for manual adjustments.';
COMMENT ON COLUMN public.inventory_logs.change_amount
    IS 'Signed delta applied to stock_level. Negative = consumed, positive = restocked.';
COMMENT ON COLUMN public.inventory_logs.reason
    IS 'Short reason code: ORDER_DEDUCTION, MANUAL_RESTOCK, WASTE_WRITE_OFF.';


-- Indexes for the three most common query patterns --------------------------

-- "Show me the full history of ingredient X"
CREATE INDEX IF NOT EXISTS idx_inventory_logs_inventory_id
    ON public.inventory_logs(inventory_id);

-- "Show me all stock movements linked to order Y"
CREATE INDEX IF NOT EXISTS idx_inventory_logs_order_id
    ON public.inventory_logs(order_id);

-- "Show me everything that happened today / in this shift"
CREATE INDEX IF NOT EXISTS idx_inventory_logs_created_at
    ON public.inventory_logs(created_at DESC);


-- ============================================================================
-- SECTION 4 — Row Level Security for inventory_logs
-- ============================================================================
-- Strategy mirrors store_inventory (admin-staff only):
--   * authenticated users (kitchen / admin staff) -> SELECT, INSERT
--   * no UPDATE / DELETE -> logs are append-only (immutable audit trail)
--   * anon role has NO access whatsoever
-- ============================================================================
ALTER TABLE public.inventory_logs ENABLE ROW LEVEL SECURITY;

-- Staff can read the full audit trail
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
        AND   tablename  = 'inventory_logs'
        AND   policyname = 'Staff can view inventory logs'
    ) THEN
        CREATE POLICY "Staff can view inventory logs"
            ON public.inventory_logs
            FOR SELECT
            TO authenticated
            USING (true);
    END IF;
END;
$$;

-- Staff (and the SECURITY DEFINER place_order function) can insert log rows.
-- The function runs as the table owner so it bypasses RLS already, but this
-- policy allows direct inserts from authenticated API calls (e.g. manual
-- adjustments or a future /restock endpoint).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
        AND   tablename  = 'inventory_logs'
        AND   policyname = 'Staff can insert inventory logs'
    ) THEN
        CREATE POLICY "Staff can insert inventory logs"
            ON public.inventory_logs
            FOR INSERT
            TO authenticated
            WITH CHECK (true);
    END IF;
END;
$$;

-- Intentionally NO UPDATE or DELETE policy.
-- Rows are immutable once written. A superuser / service-role key can still
-- perform corrections via the Supabase dashboard if required.


-- ============================================================================
-- SECTION 5 — Replace place_order RPC to emit inventory_logs entries
-- ============================================================================
-- Changes vs. the v1 function (place_order_rpc.sql):
--   * The order INSERT has been moved to PASS 2 (before stock deduction) so
--     we have a valid order_id to store in the log row.
--   * After each UPDATE to store_inventory, an INSERT into inventory_logs is
--     performed inside the same transaction (PASS 3).
--   * All other logic (two-pass lock/check, shortage accumulation, low-stock
--     alerts) is preserved exactly.
--
-- FIX for error 42725 ("function name is not unique"):
--   PostgreSQL raises 42725 for both DROP FUNCTION and CREATE OR REPLACE
--   FUNCTION when multiple overloads share the same name and no argument
--   list is provided (or when the replacement signature matches none of
--   the existing overloads exactly).
--   The DO block below queries pg_proc to discover and DROP every overload
--   of public.place_order dynamically, so that the subsequent CREATE starts
--   from a clean slate regardless of how many legacy signatures exist.
-- ============================================================================

-- Step 5a: Drop ALL existing overloads of place_order dynamically -----------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure::TEXT AS drop_target
        FROM   pg_proc     p
        JOIN   pg_namespace n ON n.oid = p.pronamespace
        WHERE  n.nspname   = 'public'
        AND    p.proname   = 'place_order'
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.drop_target || ' CASCADE';
        RAISE NOTICE 'Dropped overload: %', r.drop_target;
    END LOOP;
END;
$$;

-- Step 5b: Create the upgraded function with the canonical signature --------
CREATE FUNCTION public.place_order(
    p_menu_item_id  UUID,
    p_quantity      INT
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
    v_has_shortage        BOOLEAN := FALSE;
    v_shortages           JSONB   := '[]'::JSONB;
    v_deductions          JSONB   := '[]'::JSONB;
    v_low_stock_alerts    JSONB   := '[]'::JSONB;
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
        RAISE EXCEPTION 'NO_RECIPE_FOUND: No recipe is configured for menu item % (%).',
            v_menu_item_name, p_menu_item_id
            USING ERRCODE = 'P0003';
    END IF;

    -- ----------------------------------------------------------------
    -- PASS 1 — Lock inventory rows (ORDER BY id prevents deadlocks)
    --          and collect shortage information.
    --
    --  FOR UPDATE OF si acquires a row-level lock on each matching
    --  store_inventory row. No other concurrent transaction can
    --  modify these rows until our transaction commits or rolls back,
    --  making the check-then-update race-condition-free.
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
    IF v_has_shortage THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: %', v_shortages::TEXT
            USING ERRCODE = 'P0001',
                  DETAIL  = v_shortages::TEXT;
    END IF;

    -- ----------------------------------------------------------------
    -- PASS 2 — Insert the order record so we have a valid order_id
    --          to reference in inventory_logs. Rows are still locked
    --          from Pass 1.
    -- ----------------------------------------------------------------
    INSERT INTO public.orders (menu_item_id, quantity)
    VALUES (p_menu_item_id, p_quantity)
    RETURNING id, created_at
    INTO v_order_id, v_order_created_at;

    -- ----------------------------------------------------------------
    -- PASS 3 — Deduct stock + write one inventory_log row per ingredient.
    --
    --  Both writes are inside the same transaction. If anything fails,
    --  both the UPDATE and the INSERT are rolled back atomically.
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

        -- Deduct stock
        UPDATE public.store_inventory
        SET    stock_level = stock_level - v_total_needed
        WHERE  id = v_ingredient_id;

        -- Write the audit log entry (change_amount is negative = consumed)
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

        -- Accumulate the response payload
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
                    'ingredient_name',     v_ingredient_name,
                    'unit',                v_unit,
                    'new_stock_level',     ROUND((v_stock_level - v_total_needed)::NUMERIC, 4),
                    'low_stock_threshold', v_low_stock_threshold
                )
            );
        END IF;
    END LOOP;

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

GRANT EXECUTE ON FUNCTION public.place_order(UUID, INT) TO authenticated;

COMMENT ON FUNCTION public.place_order(UUID, INT) IS
'Atomic order placement v2: validates stock, locks inventory rows, inserts the
 order, deducts stock, and writes one inventory_logs audit row per ingredient -
 all in one PostgreSQL transaction.
 Returns a JSONB payload with the order details, per-ingredient deductions,
 and any low-stock alerts triggered by the deduction.';


-- ============================================================================
-- SECTION 6 — Convenience view: human-readable audit trail
-- ============================================================================
CREATE OR REPLACE VIEW public.v_inventory_audit AS
SELECT
    il.id                           AS log_id,
    il.created_at,
    si.name                         AS ingredient_name,
    si.unit,
    il.change_amount,
    si.stock_level                  AS current_stock,
    il.reason,
    il.order_id,
    o.menu_item_id,
    mi.name                         AS menu_item_name,
    o.quantity                      AS order_quantity
FROM   public.inventory_logs  il
JOIN   public.store_inventory si  ON si.id = il.inventory_id
LEFT   JOIN public.orders     o   ON o.id  = il.order_id
LEFT   JOIN public.menu_items mi  ON mi.id = o.menu_item_id
ORDER  BY il.created_at DESC;

COMMENT ON VIEW public.v_inventory_audit IS
'Human-readable audit view joining inventory_logs to store_inventory, orders,
 and menu_items. Ordered newest-first. Use for admin Stock Movements dashboards.';


COMMIT;


-- =============================================================================
-- POST-MIGRATION VERIFICATION QUERIES
-- =============================================================================
-- Run these after the migration to confirm everything applied correctly.
-- =============================================================================

-- 1. Confirm inventory_logs table columns
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
AND    table_name   = 'inventory_logs'
ORDER  BY ordinal_position;

-- 2. Confirm RLS is enabled on both new and existing tables
SELECT tablename, rowsecurity
FROM   pg_tables
WHERE  schemaname = 'public'
AND    tablename  IN ('inventory_logs', 'recipes', 'store_inventory', 'orders')
ORDER  BY tablename;

-- 3. Confirm FK constraints on inventory_logs and recipes
SELECT
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name   AS foreign_table,
    ccu.column_name  AS foreign_column,
    rc.delete_rule
FROM   information_schema.table_constraints    tc
JOIN   information_schema.key_column_usage     kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema   = kcu.table_schema
JOIN   information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema   = tc.table_schema
JOIN   information_schema.referential_constraints rc
         ON rc.constraint_name = tc.constraint_name
WHERE  tc.constraint_type = 'FOREIGN KEY'
AND    tc.table_schema    = 'public'
AND    tc.table_name      IN ('inventory_logs', 'recipes')
ORDER  BY tc.table_name, tc.constraint_name;

-- 4. Confirm RLS policies on inventory_logs
SELECT policyname, cmd, roles
FROM   pg_policies
WHERE  schemaname = 'public'
AND    tablename  = 'inventory_logs'
ORDER  BY policyname;

-- 5. Smoke test: confirm the updated place_order function is present
SELECT proname, prosrc IS NOT NULL AS has_body
FROM   pg_proc
WHERE  proname      = 'place_order'
AND    pronamespace = 'public'::regnamespace;
