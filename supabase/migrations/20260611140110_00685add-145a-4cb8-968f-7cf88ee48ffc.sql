CREATE TABLE public.pos_printers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  ip text NOT NULL,
  port integer NOT NULL DEFAULT 80,
  protocol text NOT NULL DEFAULT 'http' CHECK (protocol IN ('http','https')),
  paper_width text NOT NULL DEFAULT '80mm' CHECK (paper_width IN ('80mm','58mm')),
  brand text NOT NULL DEFAULT 'epson_epos',
  device_id text NOT NULL DEFAULT 'local_printer',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pos_printers_legal_entity ON public.pos_printers(legal_entity_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_printers TO authenticated;
GRANT ALL ON public.pos_printers TO service_role;

ALTER TABLE public.pos_printers ENABLE ROW LEVEL SECURITY;

CREATE POLICY pos_printers_select ON public.pos_printers FOR SELECT
  USING (has_position_in_entity(legal_entity_id) OR is_platform_admin() OR is_kiosk_user());

CREATE POLICY pos_printers_insert ON public.pos_printers FOR INSERT
  WITH CHECK (has_position_in_entity(legal_entity_id) AND has_app_write_access('pos_styring'));

CREATE POLICY pos_printers_update ON public.pos_printers FOR UPDATE
  USING (has_position_in_entity(legal_entity_id) AND has_app_write_access('pos_styring'))
  WITH CHECK (has_position_in_entity(legal_entity_id) AND has_app_write_access('pos_styring'));

CREATE POLICY pos_printers_delete ON public.pos_printers FOR DELETE
  USING (has_position_in_entity(legal_entity_id) AND has_app_write_access('pos_styring'));

CREATE TRIGGER trg_pos_printers_updated_at
  BEFORE UPDATE ON public.pos_printers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();