-- =============================================================================
-- Daris Hotel — Migration: Kitchen Display System (KDS) columns
-- =============================================================================
-- Version  : v4
-- Depends  : migration_recipe_audit.sql (v3) must already be applied.
-- Safe to  : Run on a LIVE database. All statements are idempotent.
--            Uses ADD COLUMN IF NOT EXISTS — will NOT error on re-run.
--            Does NOT modify or drop any existing column or constraint.
--
-- What this migration adds:
--   1. kitchen_status      VARCHAR(20) DEFAULT 'new' NOT NULL
--        Lifecycle state visible on the Kitchen Display System (KDS).
--        Allowed values: 'new' | 'preparing' | 'served'
--        CONSTRAINT enforced by a CHECK to prevent typos.
--
--   2. is_kitchen_cleared  BOOLEAN DEFAULT FALSE NOT NULL
--        Set to TRUE by an admin "clear board" action.
--        Hides served orders from the KDS without hard-deleting them,
--        keeping the financial/audit trail 100% intact.
--
-- NOTE: The existing `status` column (financial status) is NOT touched.
-- =============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1 — Add kitchen_status column
-- ============================================================================
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS kitchen_status VARCHAR(20)
        NOT NULL
        DEFAULT 'new'
        CONSTRAINT orders_kitchen_status_check
            CHECK (kitchen_status IN ('new', 'preparing', 'served'));

COMMENT ON COLUMN public.orders.kitchen_status IS
'KDS lifecycle state. Managed exclusively by kitchen staff via PATCH /orders/{id}/kitchen-status.
 Allowed values: new (just placed) | preparing (being cooked) | served (delivered to table).
 This column is INDEPENDENT of the financial status column.';

-- ============================================================================
-- SECTION 2 — Add is_kitchen_cleared column
-- ============================================================================
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS is_kitchen_cleared BOOLEAN
        NOT NULL
        DEFAULT FALSE;

COMMENT ON COLUMN public.orders.is_kitchen_cleared IS
'When TRUE, the order is hidden from the active KDS board.
 Set by the admin "Clear Board" action (POST /orders/clear-kitchen).
 Does NOT delete the record — financial history and audit logs are preserved.';

-- ============================================================================
-- SECTION 3 — Performance indexes
-- ============================================================================
-- The KDS query filter is always:
--   WHERE is_kitchen_cleared = FALSE
--   (optionally AND kitchen_status = 'new' / 'preparing')
-- A partial index on the active (uncleared) orders is cheapest.

CREATE INDEX IF NOT EXISTS idx_orders_kds_active
    ON public.orders (created_at DESC)
    WHERE is_kitchen_cleared = FALSE;

COMMENT ON INDEX public.idx_orders_kds_active IS
'Partial index supporting the KDS live-board query: active (uncleared) orders
 ordered newest-first. Keeps the KDS polling fast even at high order volumes.';

-- A second index makes filtering by kitchen_status within cleared/uncleared efficient.
CREATE INDEX IF NOT EXISTS idx_orders_kitchen_status
    ON public.orders (kitchen_status, is_kitchen_cleared);

COMMENT ON INDEX public.idx_orders_kitchen_status IS
'Composite index for queries that filter by kitchen_status and/or is_kitchen_cleared.';

-- ============================================================================
-- SECTION 4 — Backfill existing rows
-- ============================================================================
-- Rows inserted before this migration have DEFAULT values applied at ALTER TABLE
-- time by PostgreSQL (IF NOT EXISTS path). The UPDATE below is a safety net
-- in case the column already existed without a default.
UPDATE public.orders
SET
    kitchen_status     = 'new',
    is_kitchen_cleared = FALSE
WHERE
    kitchen_status     IS NULL
    OR is_kitchen_cleared IS NULL;

-- ============================================================================
-- SECTION 5 — Update RLS (Row Level Security)
-- ============================================================================
-- The existing RLS policies on `orders` already cover SELECT/INSERT for
-- authenticated staff. We only need to ensure authenticated users can UPDATE
-- the two new KDS columns (kitchen staff patching kitchen_status,
-- admin clearing the board).
--
-- If your RLS policy already grants UPDATE on orders to authenticated users,
-- no change is needed here. The DO block below adds a policy ONLY if one
-- does not already exist.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'orders'
          AND policyname = 'Staff can update orders'
    ) THEN
        CREATE POLICY "Staff can update orders"
            ON public.orders
            FOR UPDATE
            TO authenticated
            USING (true)
            WITH CHECK (true);
        RAISE NOTICE 'Created RLS policy: Staff can update orders';
    ELSE
        RAISE NOTICE 'RLS policy already exists: Staff can update orders — skipped.';
    END IF;
END;
$$;

COMMIT;


-- =============================================================================
-- POST-MIGRATION VERIFICATION QUERIES
-- =============================================================================
-- Run these after the migration to confirm everything applied correctly.

-- 1. Confirm the two new columns exist with correct types and defaults
SELECT
    column_name,
    data_type,
    character_maximum_length,
    column_default,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'orders'
  AND column_name  IN ('kitchen_status', 'is_kitchen_cleared')
ORDER BY column_name;

-- 2. Confirm the CHECK constraint exists
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.orders'::regclass
  AND conname  = 'orders_kitchen_status_check';

-- 3. Confirm the new indexes exist
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename  = 'orders'
  AND indexname IN ('idx_orders_kds_active', 'idx_orders_kitchen_status');

-- 4. Confirm no existing rows have NULL in the new columns (backfill check)
SELECT COUNT(*) AS null_count
FROM public.orders
WHERE kitchen_status IS NULL OR is_kitchen_cleared IS NULL;

-- Expected: null_count = 0
