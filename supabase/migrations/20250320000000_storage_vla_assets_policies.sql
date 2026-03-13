-- Storage: ensure vla-assets bucket exists and allow authenticated uploads (path: org_id/expert_id/session_id/file).
-- Run after schema migrations. Fixes "new row violates row-level security policy" on video upload.

-- 1) Create bucket if it doesn't exist (id = name for consistency)
INSERT INTO storage.buckets (id, name, public)
VALUES ('vla-assets', 'vla-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2) Allow authenticated users to INSERT into vla-assets only under their own expert folder (path segment 2 = auth.uid())
CREATE POLICY "vla_assets_authenticated_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'vla-assets'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- 3) Allow overwrite (upsert): UPDATE own files in vla-assets
CREATE POLICY "vla_assets_authenticated_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'vla-assets'
  AND (storage.foldername(name))[2] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'vla-assets'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- 4) SELECT: allow public read so getPublicUrl() works for video/sensor URLs (bucket is public)
CREATE POLICY "vla_assets_public_select"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'vla-assets');
