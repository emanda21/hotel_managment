-- =============================================================================
-- Migration: Fix Manual Deduction Reason Display
-- Daris Hotel Management System
--
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- Adds a dedicated deduction_reason column to inventory_logs so that the
-- human-readable reason (Damaged, Expired, Waste, etc.) chosen in the
-- admin UI is persisted and shown in the Activity Log.
-- =============================================================================

-- 1. Add deduction_reason column to inventory_logs
ALTER TABLE public.inventory_logs
  ADD COLUMN IF NOT EXISTS deduction_reason TEXT;

COMMENT ON COLUMN public.inventory_logs.deduction_reason
  IS 'Human-readable reason for a MANUAL_DEDUCTION (e.g. Damaged, Expired, Staff Meal, Waste). NULL for all other log types.';

-- 2. Rebuild v_inventory_audit to expose deduction_reason
--    (DROP + recreate because Postgres cannot ADD a column to a view)
DROP VIEW IF EXISTS public.v_inventory_audit;

CREATE OR REPLACE VIEW public.v_inventory_audit AS
SELECT
    il.id                                        AS log_id,
    il.created_at,

    -- Ingredient details
    si.id                                        AS ingredient_id,
    si.name                                      AS ingredient_name,
    si.unit,

    -- Stock change
    il.change_amount,
    si.stock_level                               AS current_stock,

    -- Why the change happened (MANUAL_RESTOCK / MANUAL_DEDUCTION / ORDER_DEDUCTION / etc.)
    il.reason,

    -- Who performed a restock / initial stock addition
    il.added_by,

    -- Who performed a manual deduction
    il.deducted_by,

    -- Human-readable reason for manual deductions (e.g. Damaged, Expired, Waste)
    il.deduction_reason,

    -- Order details (populated for ORDER_DEDUCTION / ORDER_SERVED_DEDUCTION rows)
    il.order_id,
    o.quantity                                   AS order_quantity,

    -- Menu item that triggered the deduction (via the order)
    mi.name                                      AS menu_item_name

FROM  public.inventory_logs        il
LEFT JOIN public.store_inventory   si  ON si.id = il.inventory_id
LEFT JOIN public.orders            o   ON o.id  = il.order_id
LEFT JOIN public.menu_items        mi  ON mi.id = o.menu_item_id
ORDER BY il.created_at DESC;

COMMENT ON VIEW public.v_inventory_audit
  IS 'Full audit trail — includes deduction_reason for MANUAL_DEDUCTION rows.';

-- =============================================================================
-- Verification (uncomment to test after running)
-- =============================================================================
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'inventory_logs' AND column_name = 'deduction_reason';

-- SELECT log_id, reason, deducted_by, deduction_reason FROM public.v_inventory_audit
-- WHERE reason = 'MANUAL_DEDUCTION' LIMIT 5;
