-- Invitations table for OTP-based user activation
CREATE TABLE public.user_invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_invitations_email ON public.user_invitations (lower(email));
CREATE INDEX idx_user_invitations_user_id ON public.user_invitations (user_id);

-- Auth-only via security-definer functions / edge functions (service_role).
-- No anon/authenticated grants on purpose — all access goes through edge functions.
GRANT ALL ON public.user_invitations TO service_role;

ALTER TABLE public.user_invitations ENABLE ROW LEVEL SECURITY;

-- Platform owners may view invitations (for "Send ny kode" UI / debugging).
CREATE POLICY "Owners can view invitations"
ON public.user_invitations
FOR SELECT
TO authenticated
USING (public.is_platform_owner(auth.uid()));
