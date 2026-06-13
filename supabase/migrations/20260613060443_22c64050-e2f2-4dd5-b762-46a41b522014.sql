
CREATE TABLE public.pos_function_images (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id) ON DELETE CASCADE,
  function_code text NOT NULL,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (legal_entity_id, function_code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_function_images TO authenticated;
GRANT ALL ON public.pos_function_images TO service_role;

ALTER TABLE public.pos_function_images ENABLE ROW LEVEL SECURITY;

-- Admins/operatører i entity kan administrere
CREATE POLICY "pos_function_images_admin_all"
ON public.pos_function_images
FOR ALL
TO authenticated
USING (public.has_position_in_entity(legal_entity_id))
WITH CHECK (public.has_position_in_entity(legal_entity_id));

-- Kiosk-brukere kan lese
CREATE POLICY "pos_function_images_kiosk_select"
ON public.pos_function_images
FOR SELECT
TO authenticated
USING (public.is_kiosk_user());

CREATE TRIGGER trg_pos_function_images_updated_at
BEFORE UPDATE ON public.pos_function_images
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
