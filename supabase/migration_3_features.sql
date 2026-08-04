-- =============================================================================
-- Migration: 3 Critical Features
-- Daris Hotel Management System
--
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- Safe to run once. All statements use IF NOT EXISTS guards.
-- =============================================================================

-- =============================================================================
-- FEATURE 1: Menu Item Availability Toggle
-- Adds is_available boolean column to menu_items.
-- Default = true so ALL existing items remain available immediately.
-- =============================================================================

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.menu_items.is_available
  IS 'When false, the item is dimmed on the customer menu and cannot be ordered.';

-- =============================================================================
-- FEATURE 3: Inventory Manual Deduction — Audit Log Enhancements
-- Adds deducted_by column (mirrors added_by for restock rows).
-- =============================================================================

ALTER TABLE public.inventory_logs
  ADD COLUMN IF NOT EXISTS deducted_by TEXT;

COMMENT ON COLUMN public.inventory_logs.deducted_by
  IS 'Name of the person who performed a manual stock deduction (MANUAL_DEDUCTION rows only).';

-- =============================================================================
-- Rebuild v_inventory_audit view to expose deducted_by
-- DROP + recreate because Postgres does not support ALTER VIEW for column adds.
-- =============================================================================

DROP VIEW IF EXISTS public.v_inventory_audit;

CREATE OR REPLACE VIEW public.v_inventory_audit AS
SELECT
    il.id                                        AS log_id,
    il.created_at,
    si.id                                        AS ingredient_id,
    si.name                                      AS ingredient_name,
    si.unit,
    il.change_amount,
    COALESCE(il.current_stock, si.stock_level)   AS current_stock,
    il.reason,
    il.added_by,
    il.deducted_by,
    il.order_id,
    o.quantity                                   AS order_quantity,
    mi.name                                      AS menu_item_name
FROM  public.inventory_logs        il
LEFT JOIN public.store_inventory   si  ON si.id = il.inventory_id
LEFT JOIN public.orders            o   ON o.id  = il.order_id
LEFT JOIN public.menu_items        mi  ON mi.id = o.menu_item_id
ORDER BY il.created_at DESC;

COMMENT ON VIEW public.v_inventory_audit
  IS 'Full audit trail — joins inventory_logs with ingredient, order, and menu item details. '
     'Includes added_by (restock) and deducted_by (manual deduction) fields.';

-- =============================================================================
-- Verification (uncomment to test)
-- =============================================================================
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'menu_items' AND column_name = 'is_available';

-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'inventory_logs' AND column_name = 'deducted_by';

-- SELECT * FROM public.v_inventory_audit LIMIT 5;
