-- Rename vendor → organization everywhere (table, columns, indexes, policies, trigger, comments).
-- Run after all prior migrations. Keeps same UUIDs and data.

-- 1) Table and columns
ALTER TABLE public.vendors RENAME TO organizations;

ALTER TABLE public.profiles
  RENAME COLUMN vendor_id TO organization_id;
ALTER TABLE public.sessions
  RENAME COLUMN vendor_id TO organization_id;
ALTER TABLE public.tasks
  RENAME COLUMN vendor_id TO organization_id;

-- 2) Indexes
ALTER INDEX IF EXISTS idx_vendors_slug RENAME TO idx_organizations_slug;
ALTER INDEX IF EXISTS idx_profiles_vendor_id RENAME TO idx_profiles_organization_id;
ALTER INDEX IF EXISTS idx_sessions_vendor_id RENAME TO idx_sessions_organization_id;
ALTER INDEX IF EXISTS idx_tasks_vendor_id RENAME TO idx_tasks_organization_id;

-- 3) Trigger
DROP TRIGGER IF EXISTS vendors_updated_at ON public.organizations;
CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) RLS: organizations (drop vendor-named policies, create organization-named)
DROP POLICY IF EXISTS vendors_select_own ON public.organizations;
CREATE POLICY organizations_select_own ON public.organizations
  FOR SELECT USING (
    public.is_platform_admin()
    OR id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    OR allow_open_signup = true
    OR slug IS NOT NULL
  );

-- 5) RLS: profiles (recreate with organization_id)
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;

CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT USING (
    auth.uid() = id
    OR public.is_platform_admin()
    OR (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'annotator')))
  );
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE USING (
    auth.uid() = id
    OR public.is_platform_admin()
  );
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id AND organization_id IS NOT NULL);

-- 6) RLS: sessions
DROP POLICY IF EXISTS sessions_insert_own ON public.sessions;
DROP POLICY IF EXISTS sessions_select_own ON public.sessions;
DROP POLICY IF EXISTS sessions_update_own ON public.sessions;

CREATE POLICY sessions_insert_own ON public.sessions
  FOR INSERT WITH CHECK (
    auth.uid() = expert_id
    AND organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
  );
CREATE POLICY sessions_select_own ON public.sessions
  FOR SELECT USING (
    public.is_platform_admin()
    OR organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
  );
CREATE POLICY sessions_update_own ON public.sessions
  FOR UPDATE USING (
    public.is_platform_admin()
    OR (expert_id = auth.uid() AND organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()))
  );

-- 7) RLS: assets
DROP POLICY IF EXISTS assets_insert_session_owner ON public.assets;
DROP POLICY IF EXISTS assets_select_own ON public.assets;

CREATE POLICY assets_insert_session_owner ON public.assets
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = assets.session_id AND s.expert_id = auth.uid() AND s.organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    )
  );
CREATE POLICY assets_select_own ON public.assets
  FOR SELECT USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = assets.session_id
      AND s.organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    )
  );

-- 8) RLS: tasks (drop vendor-named, create organization-named)
DROP POLICY IF EXISTS tasks_select_vendor ON public.tasks;
DROP POLICY IF EXISTS tasks_insert_vendor ON public.tasks;
DROP POLICY IF EXISTS tasks_update_vendor ON public.tasks;
DROP POLICY IF EXISTS tasks_delete_vendor ON public.tasks;

CREATE POLICY tasks_select_organization ON public.tasks
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    OR public.is_platform_admin()
  );
CREATE POLICY tasks_insert_organization ON public.tasks
  FOR INSERT WITH CHECK (
    organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'platform_admin'))
    OR public.is_platform_admin()
  );
CREATE POLICY tasks_update_organization ON public.tasks
  FOR UPDATE USING (
    organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'platform_admin'))
    OR public.is_platform_admin()
  );
CREATE POLICY tasks_delete_organization ON public.tasks
  FOR DELETE USING (
    organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'platform_admin'))
    OR public.is_platform_admin()
  );

-- 9) Comments
COMMENT ON TABLE public.organizations IS 'Multi-tenant organizations; data scoped by organization_id';
COMMENT ON COLUMN public.profiles.organization_id IS 'Organization this user belongs to';
COMMENT ON COLUMN public.sessions.organization_id IS 'Organization that owns this session (same as expert’s org)';
COMMENT ON COLUMN public.organizations.allow_open_signup IS 'If true, this org appears in the sign-up Organization dropdown';
COMMENT ON FUNCTION public.is_platform_admin() IS 'True if current user has role platform_admin; used in RLS for cross-org access';
COMMENT ON TABLE public.tasks IS 'Organization-defined tasks: name + instructions for what the expert should record';
