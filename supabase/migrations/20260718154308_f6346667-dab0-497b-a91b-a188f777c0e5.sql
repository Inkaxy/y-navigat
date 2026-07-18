
CREATE TABLE IF NOT EXISTS public.pos_saf_t_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id) ON DELETE RESTRICT,
  terminal_id uuid REFERENCES public.pos_terminals(id) ON DELETE SET NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  storage_path text,
  file_name text NOT NULL,
  file_size_bytes bigint,
  sha256 text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  event_count int NOT NULL DEFAULT 0,
  transaction_count int NOT NULL DEFAULT 0,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  generated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_saf_t_exports_entity
  ON public.pos_saf_t_exports(legal_entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_saf_t_exports_terminal
  ON public.pos_saf_t_exports(terminal_id);

GRANT SELECT ON public.pos_saf_t_exports TO authenticated;
GRANT ALL ON public.pos_saf_t_exports TO service_role;

ALTER TABLE public.pos_saf_t_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view SAF-T exports for their entities"
  ON public.pos_saf_t_exports FOR SELECT
  TO authenticated
  USING (public.has_position_in_entity(legal_entity_id));

CREATE POLICY "Service role manages SAF-T exports"
  ON public.pos_saf_t_exports FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_pos_saf_t_exports_updated_at
BEFORE UPDATE ON public.pos_saf_t_exports
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage RLS: la autentiserte brukere lese filer for selskap de har posisjon i.
-- Filbanen bygges som: <legal_entity_id>/<export_id>.xml
CREATE POLICY "Users read SAF-T export files for their entities"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'pos-saf-t-exports'
    AND public.has_position_in_entity(
      (split_part(name, '/', 1))::uuid
    )
  );
