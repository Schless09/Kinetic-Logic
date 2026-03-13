-- Invite links and open sign-up: vendors can share a link or allow users to choose.

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS allow_open_signup boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.vendors.allow_open_signup IS 'If true, this vendor appears in the sign-up "Recording for" dropdown.';

-- Allow unauthenticated read of vendors that have invite slug or allow open signup (for sign-up page).
DROP POLICY IF EXISTS vendors_select_own ON public.vendors;
CREATE POLICY vendors_select_own ON public.vendors
  FOR SELECT USING (
    public.is_platform_admin()
    OR id IN (SELECT vendor_id FROM public.profiles WHERE id = auth.uid())
    OR allow_open_signup = true
    OR slug IS NOT NULL
  );

-- Optional: set default vendor as open signup so selector works out of the box
UPDATE public.vendors
SET allow_open_signup = true
WHERE slug = 'default' AND allow_open_signup = false;
