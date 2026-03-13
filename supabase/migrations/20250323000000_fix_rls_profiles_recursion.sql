-- Fix: infinite recursion in RLS policies for public.profiles (and any policy that queries profiles).
-- Root cause: policies on profiles (and other tables) used subqueries against public.profiles to check role/org,
-- which triggers profiles RLS again and can recurse. We replace those checks with SECURITY DEFINER helpers
-- that read role with row_security disabled.

-- 1) Helper: current user's role (bypasses RLS safely)
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.app_role;
BEGIN
  -- Bypass RLS for this lookup
  PERFORM set_config('row_security', 'off', true);
  SELECT role INTO r FROM public.profiles WHERE id = auth.uid();
  RETURN r;
END;
$$;

COMMENT ON FUNCTION public.current_user_role() IS 'Returns current user role from profiles with row_security disabled (avoids RLS recursion)';

-- 2) Re-define is_platform_admin to rely on current_user_role()
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_role() = 'platform_admin';
$$;

COMMENT ON FUNCTION public.is_platform_admin() IS 'True if current user has role platform_admin; avoids RLS recursion via current_user_role()';

-- 3) Profiles: drop and recreate policies without subqueries on public.profiles
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;

-- Users can read their own profile; platform_admin can read all; org admins/annotators can read profiles in their orgs
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT USING (
    auth.uid() = id
    OR public.is_platform_admin()
    OR (
      organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
      AND public.current_user_role() IN ('admin', 'annotator', 'platform_admin')
    )
  );

-- Users can update own profile; platform_admin can update any
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE USING (
    auth.uid() = id
    OR public.is_platform_admin()
  );

-- Users can insert their own profile row (signup flow); must have org set
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT WITH CHECK (
    auth.uid() = id
    AND organization_id IS NOT NULL
  );

-- 4) Replace other policies that query public.profiles for role checks (to avoid recursion elsewhere)

-- Tasks: insert/update/delete requires org admin (or platform admin)
DROP POLICY IF EXISTS tasks_insert_organization ON public.tasks;
DROP POLICY IF EXISTS tasks_update_organization ON public.tasks;
DROP POLICY IF EXISTS tasks_delete_organization ON public.tasks;

CREATE POLICY tasks_insert_organization ON public.tasks
  FOR INSERT WITH CHECK (
    (
      organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
      AND public.current_user_role() IN ('admin', 'platform_admin')
    )
    OR public.is_platform_admin()
  );

CREATE POLICY tasks_update_organization ON public.tasks
  FOR UPDATE USING (
    (
      organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
      AND public.current_user_role() IN ('admin', 'platform_admin')
    )
    OR public.is_platform_admin()
  );

CREATE POLICY tasks_delete_organization ON public.tasks
  FOR DELETE USING (
    (
      organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
      AND public.current_user_role() IN ('admin', 'platform_admin')
    )
    OR public.is_platform_admin()
  );

-- Organization pricing: write requires org admin/annotator (or platform admin)
DROP POLICY IF EXISTS organization_pricing_write_admin ON public.organization_pricing;
CREATE POLICY organization_pricing_write_admin ON public.organization_pricing
  FOR ALL USING (
    public.is_platform_admin()
    OR (
      organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
      AND public.current_user_role() IN ('admin', 'annotator', 'platform_admin')
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
      AND public.current_user_role() IN ('admin', 'annotator', 'platform_admin')
    )
  );

-- Session reviews: write requires org admin/annotator (or platform admin)
DROP POLICY IF EXISTS session_reviews_write_reviewer ON public.session_reviews;
CREATE POLICY session_reviews_write_reviewer ON public.session_reviews
  FOR ALL USING (
    public.is_platform_admin()
    OR (
      organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
      AND public.current_user_role() IN ('admin', 'annotator', 'platform_admin')
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
      AND public.current_user_role() IN ('admin', 'annotator', 'platform_admin')
    )
  );

