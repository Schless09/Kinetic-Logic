-- Multi-vendor (multi-tenant) support: vendors table and vendor_id on profiles/sessions

-- Vendors: each org/partner gets a vendor; data is scoped by vendor
CREATE TABLE public.vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vendors_slug ON public.vendors(slug);

-- Add vendor_id to profiles (user belongs to one vendor)
ALTER TABLE public.profiles
  ADD COLUMN vendor_id UUID REFERENCES public.vendors(id) ON DELETE RESTRICT;

-- Backfill: create default vendor and assign existing profiles (if any)
INSERT INTO public.vendors (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'Default', 'default')
ON CONFLICT (id) DO NOTHING;

-- Only backfill if table already has rows (first migration already ran)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles LIMIT 1) THEN
    UPDATE public.profiles SET vendor_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE vendor_id IS NULL;
  END IF;
END $$;

ALTER TABLE public.profiles
  ALTER COLUMN vendor_id SET NOT NULL;

CREATE INDEX idx_profiles_vendor_id ON public.profiles(vendor_id);

-- Add vendor_id to sessions (session belongs to expert's vendor)
ALTER TABLE public.sessions
  ADD COLUMN vendor_id UUID REFERENCES public.vendors(id) ON DELETE RESTRICT;

UPDATE public.sessions s
SET vendor_id = p.vendor_id
FROM public.profiles p
WHERE s.expert_id = p.id AND s.vendor_id IS NULL;

UPDATE public.sessions
SET vendor_id = '00000000-0000-0000-0000-000000000001'::uuid
WHERE vendor_id IS NULL;

ALTER TABLE public.sessions
  ALTER COLUMN vendor_id SET NOT NULL;

CREATE INDEX idx_sessions_vendor_id ON public.sessions(vendor_id);

-- RLS for vendors (users can only read their own vendor)
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendors_select_own ON public.vendors
  FOR SELECT USING (
    id IN (SELECT vendor_id FROM public.profiles WHERE id = auth.uid())
  );

-- Drop old policies so we can replace with vendor-scoped ones
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;

CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT USING (
    auth.uid() = id
    OR (vendor_id IN (SELECT vendor_id FROM public.profiles WHERE id = auth.uid())
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'annotator')))
  );
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id AND vendor_id IS NOT NULL);

DROP POLICY IF EXISTS sessions_insert_own ON public.sessions;
DROP POLICY IF EXISTS sessions_select_own ON public.sessions;
DROP POLICY IF EXISTS sessions_update_own ON public.sessions;

CREATE POLICY sessions_insert_own ON public.sessions
  FOR INSERT WITH CHECK (
    auth.uid() = expert_id
    AND vendor_id = (SELECT vendor_id FROM public.profiles WHERE id = auth.uid())
  );
CREATE POLICY sessions_select_own ON public.sessions
  FOR SELECT USING (
    vendor_id = (SELECT vendor_id FROM public.profiles WHERE id = auth.uid())
  );
CREATE POLICY sessions_update_own ON public.sessions
  FOR UPDATE USING (
    expert_id = auth.uid()
    AND vendor_id = (SELECT vendor_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS assets_insert_session_owner ON public.assets;
DROP POLICY IF EXISTS assets_select_own ON public.assets;

CREATE POLICY assets_insert_session_owner ON public.assets
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = assets.session_id AND s.expert_id = auth.uid() AND s.vendor_id = (SELECT vendor_id FROM public.profiles WHERE id = auth.uid())
    )
  );
CREATE POLICY assets_select_own ON public.assets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = assets.session_id
      AND s.vendor_id = (SELECT vendor_id FROM public.profiles WHERE id = auth.uid())
    )
  );

-- Trigger for vendors updated_at
CREATE TRIGGER vendors_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.vendors IS 'Multi-tenant vendors (orgs/partners); data scoped by vendor_id';
COMMENT ON COLUMN public.profiles.vendor_id IS 'Vendor this user belongs to';
COMMENT ON COLUMN public.sessions.vendor_id IS 'Vendor that owns this session (same as expert’s vendor)';

-- Storage path is now /[vendor_id]/[expert_id]/[session_id]/ (see app upload-vla.ts)
