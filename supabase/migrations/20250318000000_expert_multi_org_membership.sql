-- Experts can belong to multiple organizations. Junction table + RLS updates.
-- Run after 20250317000000_rename_vendors_to_organizations.sql.

-- 1) Junction: which orgs an expert belongs to
CREATE TABLE public.profile_organizations (
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, organization_id)
);

CREATE INDEX idx_profile_organizations_profile_id ON public.profile_organizations(profile_id);
CREATE INDEX idx_profile_organizations_organization_id ON public.profile_organizations(organization_id);

-- 2) Backfill: one row per profile from their current organization_id
INSERT INTO public.profile_organizations (profile_id, organization_id)
SELECT id, organization_id FROM public.profiles
ON CONFLICT (profile_id, organization_id) DO NOTHING;

-- 3) RLS on profile_organizations
ALTER TABLE public.profile_organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY profile_organizations_select_own ON public.profile_organizations
  FOR SELECT USING (
    profile_id = auth.uid() OR public.is_platform_admin()
  );
CREATE POLICY profile_organizations_insert_own ON public.profile_organizations
  FOR INSERT WITH CHECK (profile_id = auth.uid() OR public.is_platform_admin());
CREATE POLICY profile_organizations_delete_own ON public.profile_organizations
  FOR DELETE USING (profile_id = auth.uid() OR public.is_platform_admin());

COMMENT ON TABLE public.profile_organizations IS 'Which organizations an expert belongs to; one expert can have multiple orgs';

-- 4) Organizations: user can see orgs they are a member of (or open signup/slug for sign-up page)
DROP POLICY IF EXISTS organizations_select_own ON public.organizations;
CREATE POLICY organizations_select_own ON public.organizations
  FOR SELECT USING (
    public.is_platform_admin()
    OR id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
    OR allow_open_signup = true
    OR slug IS NOT NULL
  );

-- 5) Profiles: admins/annotators see profiles in orgs they belong to
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT USING (
    auth.uid() = id
    OR public.is_platform_admin()
    OR (organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'annotator')))
  );

-- 6) Sessions: expert can create/see/update sessions for any org they belong to
DROP POLICY IF EXISTS sessions_insert_own ON public.sessions;
DROP POLICY IF EXISTS sessions_select_own ON public.sessions;
DROP POLICY IF EXISTS sessions_update_own ON public.sessions;

CREATE POLICY sessions_insert_own ON public.sessions
  FOR INSERT WITH CHECK (
    auth.uid() = expert_id
    AND organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
  );
CREATE POLICY sessions_select_own ON public.sessions
  FOR SELECT USING (
    public.is_platform_admin()
    OR organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
  );
CREATE POLICY sessions_update_own ON public.sessions
  FOR UPDATE USING (
    public.is_platform_admin()
    OR (expert_id = auth.uid() AND organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid()))
  );

-- 7) Assets: same org membership
DROP POLICY IF EXISTS assets_insert_session_owner ON public.assets;
DROP POLICY IF EXISTS assets_select_own ON public.assets;

CREATE POLICY assets_insert_session_owner ON public.assets
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = assets.session_id AND s.expert_id = auth.uid()
        AND s.organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
    )
  );
CREATE POLICY assets_select_own ON public.assets
  FOR SELECT USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = assets.session_id
      AND s.organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
    )
  );

-- 8) Tasks: experts can read tasks for any org they belong to; admins can manage
DROP POLICY IF EXISTS tasks_select_organization ON public.tasks;
DROP POLICY IF EXISTS tasks_insert_organization ON public.tasks;
DROP POLICY IF EXISTS tasks_update_organization ON public.tasks;
DROP POLICY IF EXISTS tasks_delete_organization ON public.tasks;

CREATE POLICY tasks_select_organization ON public.tasks
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
    OR public.is_platform_admin()
  );
CREATE POLICY tasks_insert_organization ON public.tasks
  FOR INSERT WITH CHECK (
    (organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'platform_admin')))
    OR public.is_platform_admin()
  );
CREATE POLICY tasks_update_organization ON public.tasks
  FOR UPDATE USING (
    (organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'platform_admin')))
    OR public.is_platform_admin()
  );
CREATE POLICY tasks_delete_organization ON public.tasks
  FOR DELETE USING (
    (organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'platform_admin')))
    OR public.is_platform_admin()
  );
