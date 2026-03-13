-- Kinetic Logic MVP: profiles, sessions, assets
-- Run in Supabase SQL Editor or via Supabase CLI

-- Enum for user role
CREATE TYPE app_role AS ENUM ('expert', 'annotator', 'admin');

-- Enum for session status
CREATE TYPE session_status AS ENUM ('recording', 'uploaded', 'verified');

-- Enum for asset type
CREATE TYPE asset_type AS ENUM ('video', 'sensor_json');

-- Profiles (extends Supabase auth; id = auth.uid())
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role app_role NOT NULL DEFAULT 'expert',
  location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sessions (capture runs by an expert)
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_metadata JSONB NOT NULL DEFAULT '{}',
  status session_status NOT NULL DEFAULT 'recording',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Assets (video + sensor JSON per session)
CREATE TABLE public.assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  type asset_type NOT NULL,
  file_url TEXT NOT NULL,
  checksum TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, type)
);

-- Indexes for common queries
CREATE INDEX idx_sessions_expert_id ON public.sessions(expert_id);
CREATE INDEX idx_sessions_status ON public.sessions(status);
CREATE INDEX idx_assets_session_id ON public.assets(session_id);
CREATE INDEX idx_profiles_email ON public.profiles(email);

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update own profile; admins can read all
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Sessions: experts own their sessions; annotators/admins can read
CREATE POLICY sessions_insert_own ON public.sessions
  FOR INSERT WITH CHECK (auth.uid() = expert_id);
CREATE POLICY sessions_select_own ON public.sessions
  FOR SELECT USING (
    expert_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('annotator', 'admin'))
  );
CREATE POLICY sessions_update_own ON public.sessions
  FOR UPDATE USING (auth.uid() = expert_id);

-- Assets: same as sessions (tied to session ownership)
CREATE POLICY assets_insert_session_owner ON public.assets
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.sessions WHERE id = session_id AND expert_id = auth.uid())
  );
CREATE POLICY assets_select_own ON public.assets
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = assets.session_id AND (s.expert_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('annotator', 'admin'))))
  );

-- Trigger: update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Optional: create profile on signup (call from app or use Supabase Auth hook)
-- INSERT into profiles (id, email, role, location) ...
-- is done app-side after signup when we have role/location.

COMMENT ON TABLE public.profiles IS 'User profiles; id matches auth.users(id)';
COMMENT ON TABLE public.sessions IS 'VLA capture sessions per expert';
COMMENT ON TABLE public.assets IS 'Video and sensor_json files per session';

-- Storage: create bucket "vla-assets" in Supabase Dashboard (Storage > New bucket).
-- Policy example (Dashboard or SQL):
--   INSERT: authenticated users, path = expert_id/session_id/*
--   SELECT: authenticated users (or public if you need signed URLs only)
-- Or run:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('vla-assets', 'vla-assets', true);
-- CREATE POLICY "Authenticated upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'vla-assets');
-- CREATE POLICY "Public read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'vla-assets');
