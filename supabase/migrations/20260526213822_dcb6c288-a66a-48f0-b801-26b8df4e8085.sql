
-- Round 10: roles, responsibility and internal collaboration

-- Team enum
DO $$ BEGIN
  CREATE TYPE public.ticket_team AS ENUM ('kundeservice','produksjon','butikk','konditor','admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add columns to tickets
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS assigned_team public.ticket_team,
  ADD COLUMN IF NOT EXISTS awaiting_internal boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tickets_assigned_team ON public.tickets(assigned_team);
CREATE INDEX IF NOT EXISTS idx_tickets_awaiting_internal ON public.tickets(awaiting_internal) WHERE awaiting_internal = true;

-- Team memberships
CREATE TABLE IF NOT EXISTS public.user_team_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  team public.ticket_team NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, team)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_team_memberships TO authenticated;
GRANT ALL ON public.user_team_memberships TO service_role;
ALTER TABLE public.user_team_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ordre users read team memberships"
  ON public.user_team_memberships FOR SELECT TO authenticated
  USING (app_access_level('ordre') <> 'none'::access_level);
CREATE POLICY "Users manage own team memberships"
  ON public.user_team_memberships FOR ALL TO authenticated
  USING (user_id = auth.uid() OR is_platform_owner(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR is_platform_owner(auth.uid()));

-- Internal comments
CREATE TABLE IF NOT EXISTS public.ticket_internal_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  body text NOT NULL,
  mentioned_teams public.ticket_team[] NOT NULL DEFAULT '{}',
  author_id uuid,
  author_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_internal_comments_ticket ON public.ticket_internal_comments(ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_internal_comments_mentions ON public.ticket_internal_comments USING GIN (mentioned_teams);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_internal_comments TO authenticated;
GRANT ALL ON public.ticket_internal_comments TO service_role;
ALTER TABLE public.ticket_internal_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ordre users read internal comments"
  ON public.ticket_internal_comments FOR SELECT TO authenticated
  USING (app_access_level('ordre') <> 'none'::access_level);
CREATE POLICY "Ordre write users insert internal comments"
  ON public.ticket_internal_comments FOR INSERT TO authenticated
  WITH CHECK (has_app_write_access('ordre') AND author_id = auth.uid());
CREATE POLICY "Authors update own internal comments"
  ON public.ticket_internal_comments FOR UPDATE TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());
CREATE POLICY "Authors delete own internal comments"
  ON public.ticket_internal_comments FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR is_platform_owner(auth.uid()));

-- Read receipts for mentions
CREATE TABLE IF NOT EXISTS public.ticket_internal_comment_reads (
  comment_id uuid NOT NULL REFERENCES public.ticket_internal_comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_internal_comment_reads TO authenticated;
GRANT ALL ON public.ticket_internal_comment_reads TO service_role;
ALTER TABLE public.ticket_internal_comment_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own reads"
  ON public.ticket_internal_comment_reads FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
