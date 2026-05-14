
-- 1) Hide credential columns from authenticated/anon roles. Edge functions using the
--    service role still have access. RLS on the row level remains in place.
REVOKE SELECT (access_token, password_hash) ON public.negotiation_recipients FROM anon, authenticated;

-- 2) Tighten pos_operators SELECT to require pos_styring app access (PIN hashes are sensitive).
DROP POLICY IF EXISTS pos_operators_select ON public.pos_operators;
CREATE POLICY pos_operators_select ON public.pos_operators
FOR SELECT
USING (
  is_platform_admin()
  OR (
    has_position_in_entity(legal_entity_id)
    AND app_access_level('pos_styring'::text) <> 'none'::access_level
  )
);

-- 3) Remove the broad ticket-attachments SELECT policy. Frontend already uses the
--    signed-URL edge function (which uses the service role) for downloads.
DROP POLICY IF EXISTS "Ordre-users can read ticket attachment files" ON storage.objects;
