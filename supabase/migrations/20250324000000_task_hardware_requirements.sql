-- Hardware requirements MVP:
-- - Experts declare what capture hardware they have on their profile (hardware_tags).
-- - Tasks declare required/preferred hardware tags.
-- - App filters tasks client-side for MVP; DB fields enable later server-side filtering.

-- 1) Profiles: hardware tags (what the expert has)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hardware_tags TEXT[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.profiles.hardware_tags IS 'Capture hardware tags the expert has (e.g. phone_imu, laptop_webcam, smart_glasses).';

-- 2) Tasks: required/preferred hardware tags + optional bounty overrides for tiers
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS required_hardware_tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS preferred_hardware_tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS bounty_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.tasks.required_hardware_tags IS 'Hardware tags required to submit for the task (subset of expert profiles.hardware_tags).';
COMMENT ON COLUMN public.tasks.preferred_hardware_tags IS 'Hardware tags preferred (can be used to increase bounty).';
COMMENT ON COLUMN public.tasks.bounty_overrides IS 'Optional tiered bounty overrides by hardware tag, e.g. {\"phone_imu\":1500,\"smart_glasses\":3500}.';

CREATE INDEX IF NOT EXISTS idx_profiles_hardware_tags_gin ON public.profiles USING GIN (hardware_tags);
CREATE INDEX IF NOT EXISTS idx_tasks_required_hardware_tags_gin ON public.tasks USING GIN (required_hardware_tags);

