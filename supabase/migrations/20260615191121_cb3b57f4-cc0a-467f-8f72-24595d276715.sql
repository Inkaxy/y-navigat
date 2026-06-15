
CREATE TABLE public.pos_keypad_theme_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  legal_entity_id UUID NOT NULL REFERENCES public.legal_entities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  theme JSONB NOT NULL DEFAULT '{}'::jsonb,
  customer_screen JSONB,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, name)
);

CREATE INDEX pos_keypad_theme_presets_le_idx ON public.pos_keypad_theme_presets(legal_entity_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_keypad_theme_presets TO authenticated;
GRANT ALL ON public.pos_keypad_theme_presets TO service_role;

ALTER TABLE public.pos_keypad_theme_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY pos_keypad_theme_presets_select ON public.pos_keypad_theme_presets
  FOR SELECT USING (has_position_in_entity(legal_entity_id) OR is_platform_admin());

CREATE POLICY pos_keypad_theme_presets_insert ON public.pos_keypad_theme_presets
  FOR INSERT WITH CHECK (has_position_in_entity(legal_entity_id) AND has_app_admin_access('pos_styring'));

CREATE POLICY pos_keypad_theme_presets_update ON public.pos_keypad_theme_presets
  FOR UPDATE USING (has_position_in_entity(legal_entity_id) AND has_app_admin_access('pos_styring'));

CREATE POLICY pos_keypad_theme_presets_delete ON public.pos_keypad_theme_presets
  FOR DELETE USING (has_position_in_entity(legal_entity_id) AND has_app_admin_access('pos_styring'));

CREATE TRIGGER pos_keypad_theme_presets_updated_at
  BEFORE UPDATE ON public.pos_keypad_theme_presets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
