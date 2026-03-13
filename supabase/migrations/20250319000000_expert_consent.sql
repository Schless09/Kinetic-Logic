-- Expert Data Contribution & Release Agreement: consent records + session provenance.
-- Run after 20250318000000_expert_multi_org_membership.sql.

-- 1) Consent records (one row per signing event; latest = current agreement)
CREATE TABLE public.expert_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recording_country TEXT NOT NULL,
  recording_region TEXT,
  enhanced_data_release boolean NOT NULL DEFAULT false,
  signature_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_expert_consents_profile_id ON public.expert_consents(profile_id);
CREATE INDEX idx_expert_consents_signed_at ON public.expert_consents(signed_at DESC);

ALTER TABLE public.expert_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY expert_consents_select_own ON public.expert_consents
  FOR SELECT USING (profile_id = auth.uid() OR public.is_platform_admin());
CREATE POLICY expert_consents_insert_own ON public.expert_consents
  FOR INSERT WITH CHECK (profile_id = auth.uid());

COMMENT ON TABLE public.expert_consents IS 'Expert Data Contribution & Release Agreement signings; signature_hash ties each session to consent for provenance';

-- 2) Link each session to the consent in effect when recording started
ALTER TABLE public.sessions
  ADD COLUMN consent_id UUID REFERENCES public.expert_consents(id) ON DELETE SET NULL;

CREATE INDEX idx_sessions_consent_id ON public.sessions(consent_id);

COMMENT ON COLUMN public.sessions.consent_id IS 'Consent record in effect when this session was recorded; for data provenance';
