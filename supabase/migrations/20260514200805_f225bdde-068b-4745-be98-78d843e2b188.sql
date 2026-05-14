
-- Helper: sjekk om bruker har aktiv stilling i en LE
CREATE OR REPLACE FUNCTION public.user_has_legal_entity_access(_le uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_positions up
    WHERE up.user_id = auth.uid()
      AND up.legal_entity_id = _le
      AND up.valid_from <= CURRENT_DATE
      AND (up.valid_to IS NULL OR up.valid_to >= CURRENT_DATE)
  )
$$;

-- Bytt ut gamle policies
DROP POLICY IF EXISTS realtime_messages_select_employees ON realtime.messages;
DROP POLICY IF EXISTS realtime_messages_insert_employees ON realtime.messages;

CREATE POLICY realtime_messages_select_le_scoped
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  topic ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:'
  AND public.user_has_legal_entity_access(substring(topic from 1 for 36)::uuid)
);

CREATE POLICY realtime_messages_insert_le_scoped
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  topic ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:'
  AND public.user_has_legal_entity_access(substring(topic from 1 for 36)::uuid)
);
