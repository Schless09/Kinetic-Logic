-- ML pipeline backbone: track processing/training/eval jobs and produced artifacts.
-- This enables the “full loop” MVP (uploaded sessions -> processing -> training -> evaluation).

-- 1) Enums for job kind + status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ml_job_kind') THEN
    CREATE TYPE public.ml_job_kind AS ENUM ('process_session', 'train', 'evaluate');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ml_job_status') THEN
    CREATE TYPE public.ml_job_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ml_artifact_type') THEN
    CREATE TYPE public.ml_artifact_type AS ENUM ('manifest', 'frames', 'model', 'metrics', 'log', 'other');
  END IF;
END $$;

-- 2) Jobs table (one row per work unit)
CREATE TABLE IF NOT EXISTS public.ml_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind public.ml_job_kind NOT NULL,
  status public.ml_job_status NOT NULL DEFAULT 'queued',
  -- Optional linkage for “process_session”; later we can use dataset/model ids
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
  -- Execution bookkeeping
  attempts INT NOT NULL DEFAULT 0,
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ml_jobs_org_status_kind ON public.ml_jobs(organization_id, status, kind);
CREATE INDEX IF NOT EXISTS idx_ml_jobs_session_id ON public.ml_jobs(session_id);
CREATE INDEX IF NOT EXISTS idx_ml_jobs_created_at ON public.ml_jobs(created_at DESC);

DROP TRIGGER IF EXISTS ml_jobs_updated_at ON public.ml_jobs;
CREATE TRIGGER ml_jobs_updated_at
  BEFORE UPDATE ON public.ml_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.ml_jobs IS 'Async pipeline jobs (process session, train, evaluate) with org scoping and retries';

-- 3) Artifacts table (pointers to outputs: files + hashes + metadata)
CREATE TABLE IF NOT EXISTS public.ml_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.ml_jobs(id) ON DELETE CASCADE,
  type public.ml_artifact_type NOT NULL,
  file_url TEXT NOT NULL,
  checksum TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ml_artifacts_job_id ON public.ml_artifacts(job_id);
CREATE INDEX IF NOT EXISTS idx_ml_artifacts_org_type_created ON public.ml_artifacts(organization_id, type, created_at DESC);

COMMENT ON TABLE public.ml_artifacts IS 'Pipeline artifact pointers (manifest, model, metrics, logs) produced by ml_jobs';

-- 4) RLS: enabled and constrained to org membership (plus platform admin)
ALTER TABLE public.ml_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_artifacts ENABLE ROW LEVEL SECURITY;

-- Select: any member of the org can read job status; platform_admin can read all
DROP POLICY IF EXISTS ml_jobs_select_org ON public.ml_jobs;
CREATE POLICY ml_jobs_select_org ON public.ml_jobs
  FOR SELECT USING (
    public.is_platform_admin()
    OR organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
  );

-- Insert/Update: only platform admins (jobs are normally created by backend/worker)
DROP POLICY IF EXISTS ml_jobs_insert_admin ON public.ml_jobs;
DROP POLICY IF EXISTS ml_jobs_update_admin ON public.ml_jobs;
CREATE POLICY ml_jobs_insert_admin ON public.ml_jobs
  FOR INSERT WITH CHECK (public.is_platform_admin());
CREATE POLICY ml_jobs_update_admin ON public.ml_jobs
  FOR UPDATE USING (public.is_platform_admin());

-- Artifacts: readable by org members; insert/update only platform admin
DROP POLICY IF EXISTS ml_artifacts_select_org ON public.ml_artifacts;
CREATE POLICY ml_artifacts_select_org ON public.ml_artifacts
  FOR SELECT USING (
    public.is_platform_admin()
    OR organization_id IN (SELECT organization_id FROM public.profile_organizations WHERE profile_id = auth.uid())
  );

DROP POLICY IF EXISTS ml_artifacts_insert_admin ON public.ml_artifacts;
CREATE POLICY ml_artifacts_insert_admin ON public.ml_artifacts
  FOR INSERT WITH CHECK (public.is_platform_admin());

-- 5) Helper: create a process_session job when a session transitions to uploaded
-- Note: this only runs on UPDATE. Session creation starts as 'recording'.
CREATE OR REPLACE FUNCTION public.enqueue_process_job_on_uploaded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF (NEW.status = 'uploaded' AND (OLD.status IS DISTINCT FROM NEW.status)) THEN
    INSERT INTO public.ml_jobs (organization_id, kind, status, session_id, input)
    VALUES (
      NEW.organization_id,
      'process_session',
      'queued',
      NEW.id,
      jsonb_build_object('session_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sessions_enqueue_process_job ON public.sessions;
CREATE TRIGGER sessions_enqueue_process_job
  AFTER UPDATE OF status ON public.sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_process_job_on_uploaded();

