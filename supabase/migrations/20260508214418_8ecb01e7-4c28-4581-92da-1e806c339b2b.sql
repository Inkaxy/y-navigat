
-- Tabell for ekstra kontaktpersoner per kunde (i tillegg til hovedkontakt på kunden)
CREATE TABLE IF NOT EXISTS public.customer_contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  name text NOT NULL,
  role text,
  email text,
  phone text,
  mobile text,
  notes text,
  is_primary boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer_id ON public.customer_contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_contacts_entity ON public.customer_contacts(legal_entity_id);

-- Sett legal_entity_id automatisk fra customers ved insert/update
CREATE OR REPLACE FUNCTION public.set_customer_contact_entity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT legal_entity_id INTO NEW.legal_entity_id
  FROM public.customers WHERE id = NEW.customer_id;
  IF NEW.legal_entity_id IS NULL THEN
    RAISE EXCEPTION 'Kunden finnes ikke';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_customer_contacts_set_entity
BEFORE INSERT OR UPDATE OF customer_id ON public.customer_contacts
FOR EACH ROW EXECUTE FUNCTION public.set_customer_contact_entity();

CREATE TRIGGER trg_customer_contacts_updated
BEFORE UPDATE ON public.customer_contacts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.customer_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_contacts_select_in_entity
ON public.customer_contacts FOR SELECT
USING (has_position_in_entity(legal_entity_id) OR is_platform_admin());

CREATE POLICY customer_contacts_insert_write
ON public.customer_contacts FOR INSERT
WITH CHECK (has_position_in_entity(legal_entity_id) AND has_app_write_access('kunder'));

CREATE POLICY customer_contacts_update_write
ON public.customer_contacts FOR UPDATE
USING (has_position_in_entity(legal_entity_id) AND has_app_write_access('kunder'))
WITH CHECK (has_position_in_entity(legal_entity_id) AND has_app_write_access('kunder'));

CREATE POLICY customer_contacts_delete_write
ON public.customer_contacts FOR DELETE
USING (has_position_in_entity(legal_entity_id) AND has_app_write_access('kunder'));
