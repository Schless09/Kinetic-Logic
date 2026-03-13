-- Platform admin RLS: run after 20250313000000_platform_admin_enum_only.sql has been committed.

-- Helper: true if current user is a platform_admin (avoids repeating subquery)
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'platform_admin'
  );
$$;

-- Vendors: platform_admin can see all
DROP POLICY IF EXISTS vendors_select_own ON public.vendors;
CREATE POLICY vendors_select_own ON public.vendors
  FOR SELECT USING (
    public.is_platform_admin()
    OR id IN (SELECT vendor_id FROM public.profiles WHERE id = auth.uid())
  );

-- Profiles: platform_admin can see all and update any (e.g. assign vendor/role)
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT USING (
    auth.uid() = id
    OR public.is_platform_admin()
    OR (vendor_id IN (SELECT vendor_id FROM public.profiles WHERE id = auth.uid())
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'annotator')))
  );
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE USING (
    auth.uid() = id
    OR public.is_platform_admin()
  );

-- Sessions: platform_admin can see and update all
DROP POLICY IF EXISTS sessions_select_own ON public.sessions;
CREATE POLICY sessions_select_own ON public.sessions
  FOR SELECT USING (
    public.is_platform_admin()
    OR vendor_id = (SELECT vendor_id FROM public.profiles WHERE id = auth.uid())
  );
DROP POLICY IF EXISTS sessions_update_own ON public.sessions;
CREATE POLICY sessions_update_own ON public.sessions
  FOR UPDATE USING (
    public.is_platform_admin()
    OR (expert_id = auth.uid() AND vendor_id = (SELECT vendor_id FROM public.profiles WHERE id = auth.uid()))
  );

-- Assets: platform_admin can see all
DROP POLICY IF EXISTS assets_select_own ON public.assets;
CREATE POLICY assets_select_own ON public.assets
  FOR SELECT USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = assets.session_id
      AND s.vendor_id = (SELECT vendor_id FROM public.profiles WHERE id = auth.uid())
    )
  );

COMMENT ON FUNCTION public.is_platform_admin() IS 'True if current user has role platform_admin; used in RLS for cross-vendor access';
