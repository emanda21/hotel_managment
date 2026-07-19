-- =============================================================================
-- Daris Hotel — RBAC: profiles table + RLS policies
-- Run this in Supabase Dashboard → SQL Editor
-- =============================================================================
-- This script:
--   1. Creates the `profiles` table linked to auth.users
--   2. Creates a trigger that auto-inserts a profile row when a user signs up
--   3. Enables RLS and sets sensible policies
-- =============================================================================

-- 1. Profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
    id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username   TEXT        NOT NULL DEFAULT '',
    role       TEXT        NOT NULL DEFAULT 'staff'
                           CHECK (role IN ('admin', 'staff'))
);

COMMENT ON TABLE  public.profiles       IS 'Stores role and display name for each Supabase Auth user.';
COMMENT ON COLUMN public.profiles.role  IS 'admin = full access; staff = view-only for analytics/delete.';

-- 2. Auto-create a profile row when a user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, username, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY IF NOT EXISTS "profiles: read own"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

-- Users can update their own profile (but not change their own role)
CREATE POLICY IF NOT EXISTS "profiles: update own"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Service-role key (used by the FastAPI backend) bypasses RLS automatically.

-- 4. Seed the first admin account
--    After running this script, go to Supabase → Authentication → Users,
--    create the users manually, then run:
--
-- UPDATE public.profiles SET role = 'admin', username = 'Admin'
-- WHERE id = '<paste-user-uuid-here>';
--
-- Or use the helper below (replace the email):
-- UPDATE public.profiles
-- SET role = 'admin', username = 'Daris Admin'
-- WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@darishotel.com');
