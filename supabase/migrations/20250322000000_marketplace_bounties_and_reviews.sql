-- Marketplace iteration 1 + iteration 2 scaffolding:
-- - Organizations can set per-task bounties + caps
-- - Sessions can be approved/rejected by org reviewers before payout
-- - Basic expert trust level field (future rate limits / auto-approval)
-- - Org pricing config (floor + platform fee) as configuration only

-- 1) Profiles: trust level (0 = new, higher = more trusted)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trust_level INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.trust_level IS 'Expert trust tier (0=new). Used for submission caps/auto-approval later.';

-- 2) Tasks: bounty config (org sets bounty; platform fee handled separately)
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS bounty_cents INT,
  ADD COLUMN IF NOT EXISTS max_approved_sessions INT,
  ADD COLUMN IF NOT EXISTS budget_cents INT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS min_trust_level INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.tasks.bounty_cents IS 'Payout per approved session (in cents) for this task; lab/org sets this.';
COMMENT ON COLUMN public.tasks.max_approved_sessions IS 'Optional cap on number of approved sessions to purchase for this task.';
COMMENT ON COLUMN public.tasks.budget_cents IS 'Optional budget cap (in cents).';
COMMENT ON COLUMN public.tasks.is_active IS 'If false, task is hidden from capture task picker.';
COMMENT ON COLUMN public.tasks.min_trust_level IS 'Minimum expert trust_level required to submit for this task (scaffolding).';

CREATE INDEX IF NOT EXISTS idx_tasks_org_active ON public.tasks(organization_id, is_active);

-- 3) Org-level pricing configuration (iteration 2: floor + platform fee)
CREATE TABLE IF NOT EXISTS public.organization_pricing (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  floor_bounty_cents INT NOT NULL DEFAULT 500,
  platform_fee_bps INT NOT NULL DEFAULT 3000,
  rush_multiplier_bps INT NOT NULL DEFAULT 0,
  managed_fulfillment BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS organization_pricing_updated_at ON public.organization_pricing;
CREATE TRIGGER organization_pricing_updated_at
  BEFORE UPDATE ON public.organization_pricing
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.organization_pricing IS 'Org pricing config: minimum floor and platform fee (config-only; billing not implemented).';

ALTER TABLE public.organization_pricing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_pricing_select_org ON public.organization_pricing;
CREATE POLICY organization_pricing_select_org ON public.organization_pricing
  FOR SELECT USING (
    public.is_platform_admin()
    OR organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
  );
DROP POLICY IF EXISTS organization_pricing_write_admin ON public.organization_pricing;
CREATE POLICY organization_pricing_write_admin ON public.organization_pricing
  FOR ALL USING (
    public.is_platform_admin()
    OR (organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'annotator')))
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'annotator')))
  );

-- 4) Session review / approval gate (iteration 1)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_review_status') THEN
    CREATE TYPE public.session_review_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.session_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL UNIQUE REFERENCES public.sessions(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status public.session_review_status NOT NULL DEFAULT 'pending',
  reviewer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  payout_cents INT,
  reject_reason TEXT,
  notes TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_reviews_org_status ON public.session_reviews(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_session_reviews_session_id ON public.session_reviews(session_id);

DROP TRIGGER IF EXISTS session_reviews_updated_at ON public.session_reviews;
CREATE TRIGGER session_reviews_updated_at
  BEFORE UPDATE ON public.session_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.session_reviews IS 'Approval gate for sessions: approve/reject before contributor payout (billing not implemented).';

ALTER TABLE public.session_reviews ENABLE ROW LEVEL SECURITY;

-- Read: org members can read reviews for their org; experts can read their own via session link.
DROP POLICY IF EXISTS session_reviews_select_org ON public.session_reviews;
CREATE POLICY session_reviews_select_org ON public.session_reviews
  FOR SELECT USING (
    public.is_platform_admin()
    OR organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
  );

-- Write: org reviewers (admin/annotator) can insert/update reviews for their org
DROP POLICY IF EXISTS session_reviews_write_reviewer ON public.session_reviews;
CREATE POLICY session_reviews_write_reviewer ON public.session_reviews
  FOR ALL USING (
    public.is_platform_admin()
    OR (
      organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'annotator'))
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'annotator'))
    )
  );

-- 5) Auto-create a pending review row when a session becomes uploaded (so review UI has a queue)
CREATE OR REPLACE FUNCTION public.enqueue_session_review_on_uploaded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF (NEW.status = 'uploaded' AND (OLD.status IS DISTINCT FROM NEW.status)) THEN
    INSERT INTO public.session_reviews (session_id, organization_id, status)
    VALUES (NEW.id, NEW.organization_id, 'pending')
    ON CONFLICT (session_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sessions_enqueue_review ON public.sessions;
CREATE TRIGGER sessions_enqueue_review
  AFTER UPDATE OF status ON public.sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_session_review_on_uploaded();

