-- Enable RLS on realtime.messages (used by Supabase Realtime for Channel authorization)
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- Drop any pre-existing permissive policies if they exist
DROP POLICY IF EXISTS "Authenticated users can read realtime messages" ON realtime.messages;
DROP POLICY IF EXISTS "Authenticated users can send realtime messages" ON realtime.messages;

-- Allow only authenticated users to receive Channel events
CREATE POLICY "Authenticated users can read realtime messages"
ON realtime.messages
FOR SELECT
TO authenticated
USING (true);

-- Allow only authenticated users to broadcast / send presence
CREATE POLICY "Authenticated users can send realtime messages"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (true);
