-- =============================================================================
-- Daris Hotel — Quick Audit Diagnostic (run in Supabase SQL Editor)
-- =============================================================================
-- This tells you EXACTLY why the audit page is empty and what to do next.
-- =============================================================================

-- 1. How many rows in inventory_logs right now?
SELECT COUNT(*) AS inventory_logs_rows FROM public.inventory_logs;

-- 2. Order status breakdown
SELECT kitchen_status, COUNT(*) AS count
FROM   public.orders
GROUP  BY kitchen_status
ORDER  BY kitchen_status;

-- 3. Does mark_order_served exist with SECURITY INVOKER?
SELECT p.proname, p.prosecdef,
       CASE WHEN p.prosecdef THEN 'SECURITY DEFINER (BAD)' ELSE 'SECURITY INVOKER (GOOD)' END AS security_mode
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public' AND p.proname = 'mark_order_served';

-- 4. Find a 'new' or 'preparing' order we can use for a live test
SELECT id, kitchen_status, created_at,
       (SELECT name FROM menu_items WHERE id = orders.menu_item_id) AS item_name
FROM   public.orders
WHERE  kitchen_status IN ('new','preparing')
ORDER  BY created_at DESC
LIMIT  5;

-- =============================================================================
-- MANUAL END-TO-END TEST
-- If query #4 above returned any rows, copy one UUID and run this:
-- (Replace the UUID below with a real one from query #4)
-- =============================================================================
-- First set it to 'preparing' if it's 'new':
--   UPDATE public.orders SET kitchen_status = 'preparing' WHERE id = 'PASTE-UUID-HERE';
--
-- Then call the RPC directly:
--   SELECT public.mark_order_served('PASTE-UUID-HERE'::UUID);
--
-- Then check if audit rows appeared:
--   SELECT * FROM public.v_inventory_audit LIMIT 10;
-- =============================================================================
