-- 1) Kalibrering per skriver: skrivere lyver, så vi lagrer målt korreksjonsfaktor.
CREATE TABLE IF NOT EXISTS public.cake_printer_calibrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL,
  printer_name text NOT NULL,
  expected_mm numeric NOT NULL DEFAULT 50,
  measured_mm numeric NOT NULL,
  scale_factor numeric NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, printer_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cake_printer_calibrations TO authenticated;
GRANT ALL ON public.cake_printer_calibrations TO service_role;

ALTER TABLE public.cake_printer_calibrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY cake_printer_calibrations_all
  ON public.cake_printer_calibrations
  FOR ALL
  TO authenticated
  USING (public.is_internal_user())
  WITH CHECK (public.is_internal_user());

-- 2) Én RPC som registrerer utskrift atomisk.
--    Bare 'print' og 'reprint' setter status/teller — 'pdf' og 'test' logges bare.
CREATE OR REPLACE FUNCTION public.register_cake_image_print(
  p_ids uuid[],
  p_kind text DEFAULT 'print',
  p_sheet text DEFAULT 'A4',
  p_note text DEFAULT NULL
)
RETURNS SETOF public.cake_images
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF NOT public.is_internal_user() THEN
    RAISE EXCEPTION 'Ikke tilgang';
  END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  IF p_kind NOT IN ('print', 'reprint', 'pdf', 'test') THEN
    RAISE EXCEPTION 'Ugyldig utskriftstype: %', p_kind;
  END IF;

  INSERT INTO public.cake_image_prints (cake_image_id, printed_by, kind, sheet, note)
  SELECT unnest(p_ids), v_user, p_kind, p_sheet, p_note;

  IF p_kind IN ('print', 'reprint') THEN
    RETURN QUERY
      UPDATE public.cake_images ci
         SET status = 'skrevet_ut',
             printed_at = now(),
             print_count = COALESCE(ci.print_count, 0) + 1,
             last_printed_by = v_user,
             updated_at = now()
       WHERE ci.id = ANY(p_ids)
      RETURNING ci.*;
  ELSE
    RETURN QUERY SELECT * FROM public.cake_images WHERE id = ANY(p_ids);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.register_cake_image_print(uuid[], text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_cake_image_print(uuid[], text, text, text) TO authenticated;