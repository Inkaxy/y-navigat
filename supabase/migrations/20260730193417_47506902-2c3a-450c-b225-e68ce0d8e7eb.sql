CREATE OR REPLACE FUNCTION public._dn_lock_invoiced()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_dn uuid;
BEGIN
  v_dn := COALESCE(NEW.delivery_note_id, OLD.delivery_note_id);
  SELECT status INTO v_status FROM public.delivery_notes WHERE id = v_dn;
  IF v_status IN ('invoiced','cancelled') THEN
    RAISE EXCEPTION 'Pakkseddelen er % og kan ikke endres', v_status
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS dn_lines_lock_invoiced ON public.delivery_note_lines;
CREATE TRIGGER dn_lines_lock_invoiced
BEFORE INSERT OR UPDATE OR DELETE ON public.delivery_note_lines
FOR EACH ROW EXECUTE FUNCTION public._dn_lock_invoiced();

CREATE OR REPLACE FUNCTION public._dn_lock_header()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('invoiced','cancelled') THEN
      RAISE EXCEPTION 'Pakkseddelen er % og kan ikke slettes', OLD.status
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'invoiced' AND NEW.status = 'invoiced' THEN
    IF NEW.subtotal_excl_vat IS DISTINCT FROM OLD.subtotal_excl_vat
       OR NEW.total_vat IS DISTINCT FROM OLD.total_vat
       OR NEW.total_incl_vat IS DISTINCT FROM OLD.total_incl_vat
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.delivery_date IS DISTINCT FROM OLD.delivery_date THEN
      RAISE EXCEPTION 'Pakkseddelen er fakturert og kan ikke endres'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dn_lock_header ON public.delivery_notes;
CREATE TRIGGER dn_lock_header
BEFORE UPDATE OR DELETE ON public.delivery_notes
FOR EACH ROW EXECUTE FUNCTION public._dn_lock_header();