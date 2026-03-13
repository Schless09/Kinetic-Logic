-- Collector profile: first name, last name, phone

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN public.profiles.first_name IS 'Collector first name';
COMMENT ON COLUMN public.profiles.last_name IS 'Collector last name';
COMMENT ON COLUMN public.profiles.phone IS 'Collector phone number';
