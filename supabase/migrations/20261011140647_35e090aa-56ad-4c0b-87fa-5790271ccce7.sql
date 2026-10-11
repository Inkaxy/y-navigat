CREATE OR REPLACE FUNCTION public.rm_price_reference_now(p_raw_material_id uuid, p_supplier_id uuid, p_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_entity uuid;
begin
  if auth.uid() is null then raise exception 'Ikke innlogget' using errcode = '42501'; end if;
  select legal_entity_id into v_entity from public.raw_materials where id = p_raw_material_id;
  if v_entity is null then raise exception 'Råvaren finnes ikke'; end if;
  if not (public.has_ravarer_invoice_access(v_entity, 'read')
          or public.has_ravarer_access(auth.uid(), v_entity, 'read'::public.access_level)) then
    raise exception 'Ingen tilgang til råvaren' using errcode = '42501';
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.raw_material_suppliers where raw_material_id = p_raw_material_id and supplier_id = p_supplier_id) then
    raise exception 'Leverandøren er ikke koblet til råvaren';
  end if;
  return public.rm_price_reference(p_raw_material_id, p_supplier_id, null,
    coalesce(p_date, (now() at time zone 'Europe/Oslo')::date));
end $$;
REVOKE ALL ON FUNCTION public.rm_price_reference_now(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rm_price_reference_now(uuid, uuid, date) TO authenticated, service_role;

-- Historikk: også INSERT og flytting mellom råvarer reberegner.
CREATE OR REPLACE FUNCTION public.trg_rmph_reapply_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if tg_op = 'DELETE' then
    perform public.rm_apply_derived_cost_price(old.raw_material_id);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.superseded_at is not distinct from new.superseded_at and old.is_legacy is not distinct from new.is_legacy
     and old.price is not distinct from new.price and old.effective_date is not distinct from new.effective_date
     and old.cost_eligible is not distinct from new.cost_eligible and old.is_credit is not distinct from new.is_credit
     and old.raw_material_id is not distinct from new.raw_material_id and old.invoice_line_id is not distinct from new.invoice_line_id then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.raw_material_id is distinct from new.raw_material_id then
    perform public.rm_apply_derived_cost_price(old.raw_material_id);
  end if;
  perform public.rm_apply_derived_cost_price(new.raw_material_id);
  return new;
end $$;
REVOKE ALL ON FUNCTION public.trg_rmph_reapply_cost() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_rmph_reapply_cost ON public.raw_material_price_history;
CREATE TRIGGER trg_rmph_reapply_cost AFTER INSERT OR DELETE OR UPDATE ON public.raw_material_price_history
  FOR EACH ROW EXECUTE FUNCTION public.trg_rmph_reapply_cost();

-- Kostprisføring: ny, tilbaketrukket eller slettet føring reberegner linjens råvare.
CREATE OR REPLACE FUNCTION public.trg_ilcp_reapply_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_line uuid := coalesce(new.invoice_line_id, old.invoice_line_id); r uuid;
begin
  if tg_op = 'UPDATE' and old.revoked_at is not distinct from new.revoked_at then return new; end if;
  for r in
    select distinct x from (
      select raw_material_id x from public.invoice_lines where id = v_line
      union select raw_material_id from public.raw_material_price_history where invoice_line_id = v_line) s
    where x is not null
  loop
    perform public.rm_apply_derived_cost_price(r);
  end loop;
  return coalesce(new, old);
end $$;
REVOKE ALL ON FUNCTION public.trg_ilcp_reapply_cost() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ilcp_reapply_cost ON public.invoice_line_cost_postings;
CREATE TRIGGER trg_ilcp_reapply_cost AFTER INSERT OR DELETE OR UPDATE ON public.invoice_line_cost_postings
  FOR EACH ROW EXECUTE FUNCTION public.trg_ilcp_reapply_cost();