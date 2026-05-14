-- STEG 1: AI-analyse infrastruktur for tickets

-- 1a) Tilleggskolonner på tickets (additivt)
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS ai_confidence_score numeric(4,3),
  ADD COLUMN IF NOT EXISTS ai_error text;

-- 1b) Audit-tabell for alle AI-kall
CREATE TABLE IF NOT EXISTS public.ai_call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  triggered_by uuid,
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('success','error','rate_limited')),
  prompt_tokens integer,
  completion_tokens integer,
  cost_usd numeric(10,6),
  confidence_score numeric(4,3),
  duration_ms integer,
  error text,
  request_payload jsonb,
  response_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_call_log_ticket_id_idx ON public.ai_call_log(ticket_id);
CREATE INDEX IF NOT EXISTS ai_call_log_created_at_idx ON public.ai_call_log(created_at DESC);
CREATE INDEX IF NOT EXISTS ai_call_log_status_idx ON public.ai_call_log(status);

ALTER TABLE public.ai_call_log ENABLE ROW LEVEL SECURITY;

-- Lese-tilgang: ordrekontor/daglig_leder/platform_admin
CREATE POLICY "ai_call_log_select_ordre"
  ON public.ai_call_log FOR SELECT
  USING (public.has_ordre_settings_access());

-- Insert: kun via edge function (service role bypasser RLS) — ingen klient-policy

-- 1c) platform_settings policies for category='ordre_ai' (speil av ordre_email)
CREATE POLICY "platform_settings_select_ordre_ai"
  ON public.platform_settings FOR SELECT
  USING (category = 'ordre_ai' AND public.has_ordre_settings_access());

CREATE POLICY "platform_settings_insert_ordre_ai"
  ON public.platform_settings FOR INSERT
  WITH CHECK (category = 'ordre_ai' AND public.has_ordre_settings_access());

CREATE POLICY "platform_settings_update_ordre_ai"
  ON public.platform_settings FOR UPDATE
  USING (category = 'ordre_ai' AND public.has_ordre_settings_access())
  WITH CHECK (category = 'ordre_ai' AND public.has_ordre_settings_access());