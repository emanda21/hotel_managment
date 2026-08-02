-- =============================================================================
-- Migration: Add added_by column to inventory_logs
-- Daris Hotel Management System
--
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS).
-- =============================================================================

-- 1. Add the column (nullable so existing rows are unaffected)
ALTER TABLE public.inventory_logs
  ADD COLUMN IF NOT EXISTS added_by TEXT NULL;

COMMENT ON COLUMN public.inventory_logs.added_by
  IS 'Name of the staff member who added or restocked this inventory item. '
     'Populated for MANUAL_RESTOCK reason codes.';


-- =============================================================================
-- 2. DROP and recreate v_inventory_audit to expose the new added_by column.
--    NOTE: DROP VIEW is required because PostgreSQL cannot add columns to a
--    view in-place — CREATE OR REPLACE only works if the column list doesn't
--    change.
-- =============================================================================

DROP VIEW IF EXISTS public.v_inventory_audit;

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
    o.quantity       AS order_quantity,
    il.added_by
FROM   public.inventory_logs il
JOIN   public.store_inventory si ON si.id = il.inventory_id
LEFT   JOIN public.orders o      ON o.id  = il.order_id
LEFT   JOIN public.menu_items mi ON mi.id = o.menu_item_id
ORDER  BY il.created_at DESC;

COMMENT ON VIEW public.v_inventory_audit
  IS 'Full audit trail: every stock change event joined with ingredient, '
     'order, and menu item details. Includes added_by for restock events.';

-- Re-grant SELECT (required after DROP + CREATE)
GRANT SELECT ON public.v_inventory_audit TO anon, authenticated, service_role;


-- =============================================================================
-- Verification query (run after the migration to confirm it worked):
-- =============================================================================
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'inventory_logs' AND column_name = 'added_by';
--
-- Expected output:
--   column_name | data_type | is_nullable
--   added_by    | text      | YES
-- =============================================================================
