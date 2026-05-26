
CREATE TABLE IF NOT EXISTS public.outlet_opening_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  date date NOT NULL,
  closed boolean NOT NULL DEFAULT false,
  periods jsonb NULL,
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  UNIQUE (outlet_id, date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlet_opening_exceptions TO authenticated;
GRANT ALL ON public.outlet_opening_exceptions TO service_role;

ALTER TABLE public.outlet_opening_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ordre-users can read outlet exceptions"
  ON public.outlet_opening_exceptions
  FOR SELECT
  TO authenticated
  USING (app_access_level('ordre') <> 'none'::access_level);

CREATE POLICY "Admins can manage outlet exceptions"
  ON public.outlet_opening_exceptions
  FOR ALL
  TO authenticated
  USING (app_access_level('ordre') = 'admin'::access_level)
  WITH CHECK (app_access_level('ordre') = 'admin'::access_level);

CREATE INDEX IF NOT EXISTS idx_outlet_exceptions_outlet_date
  ON public.outlet_opening_exceptions(outlet_id, date);
