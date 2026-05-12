
-- Fix 1: Ticket attachments storage policy — only users with actual ordre access can read
DROP POLICY IF EXISTS "Ordre-users can read ticket attachment files" ON storage.objects;
CREATE POLICY "Ordre-users can read ticket attachment files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'ticket-attachments'
  AND app_access_level('ordre') <> 'none'::access_level
);

-- Fix 2: Hide supplier portal credentials from regular SELECT
REVOKE SELECT (access_token, password_hash) ON public.negotiation_recipients FROM anon, authenticated;

-- Fix 3: Hide POS operator PIN hashes from regular SELECT
REVOKE SELECT (pin_hash) ON public.pos_operators FROM anon, authenticated;
