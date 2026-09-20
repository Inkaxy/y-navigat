create or replace function public.rm_price_reference(
  p_raw_material_id uuid,
  p_supplier_id uuid,
  p_invoice_id uuid,
  p_invoice_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_first  record;
  v_second record;
  v_hist   record;
  v_entity uuid;
  v_inv    record;
begin
  if p_raw_material_id is null or p_supplier_id is null or p_invoice_date is null then
    return jsonb_build_object('source', 'none', 'reason', 'mangler_vare_leverandor_eller_dato');
  end if;

  -- Tilgangskontroll: råvaren må finnes, og kallet må gjelde samme selskap.
  select rm.legal_entity_id into v_entity
    from public.raw_materials rm
   where rm.id = p_raw_material_id;
  if v_entity is null then
    raise exception 'Råvaren finnes ikke';
  end if;

  if p_invoice_id is not null then
    select i.legal_entity_id, i.supplier_id into v_inv
      from public.invoices i
     where i.id = p_invoice_id;
    if not found then
      raise exception 'Fakturaen finnes ikke';
    end if;
    if v_inv.legal_entity_id is distinct from v_entity then
      raise exception 'Faktura og råvare tilhører ulike selskap';
    end if;
    if v_inv.supplier_id is distinct from p_supplier_id then
      raise exception 'Leverandøren stemmer ikke med fakturaen';
    end if;
  end if;

  -- Innlogget bruker må ha fakturatilgang i selskapet. Bakgrunnstjenesten (service_role)
  -- kaller uten innlogget bruker og er allerede begrenset av EXECUTE-rettigheter.
  if auth.uid() is not null and not public.has_ravarer_invoice_access(v_entity, 'read') then
    raise exception 'Ingen fakturatilgang for dette selskapet';
  end if;

  -- (a) Avtale hos DEN FAKTISKE leverandøren, gyldig på fakturadatoen.
  select s.id, s.agreed_price_per_base_unit as price, s.agreement_priority,
         s.agreement_valid_from, s.agreement_valid_to
    into v_first
    from public.raw_material_suppliers s
   where s.raw_material_id = p_raw_material_id
     and s.supplier_id     = p_supplier_id
     and s.agreed_price_per_base_unit is not null
     and public.rm_is_finite(s.agreed_price_per_base_unit)
     and s.agreed_price_per_base_unit >= 0
     and coalesce(s.agreement_valid_from, '-infinity'::date) <= p_invoice_date
     and coalesce(s.agreement_valid_to,   'infinity'::date)  >= p_invoice_date
   order by s.agreement_priority asc,
            coalesce(s.agreement_valid_from, '-infinity'::date) desc,
            s.id
   limit 1;

  if found then
    select s.id, s.agreed_price_per_base_unit as price, s.agreement_priority,
           s.agreement_valid_from
      into v_second
      from public.raw_material_suppliers s
     where s.raw_material_id = p_raw_material_id
       and s.supplier_id     = p_supplier_id
       and s.id <> v_first.id
       and s.agreed_price_per_base_unit is not null
       and coalesce(s.agreement_valid_from, '-infinity'::date) <= p_invoice_date
       and coalesce(s.agreement_valid_to,   'infinity'::date)  >= p_invoice_date
       and s.agreement_priority = v_first.agreement_priority
       and coalesce(s.agreement_valid_from, '-infinity'::date)
           = coalesce(v_first.agreement_valid_from, '-infinity'::date)
       and s.agreed_price_per_base_unit <> v_first.price
     limit 1;

    if found then
      return jsonb_build_object(
        'source', 'conflict',
        'reason', 'to_likestilte_avtaler_med_ulik_pris',
        'reference_id', v_first.id);
    end if;

    return jsonb_build_object(
      'source', 'agreement',
      'price', v_first.price,
      'reference_id', v_first.id,
      'reference_date', v_first.agreement_valid_from,
      'valid_to', v_first.agreement_valid_to);
  end if;

  -- (b) Forrige kontrollerte kjøp.
  select h.id, h.price, h.effective_date, h.invoice_id
    into v_hist
    from public.raw_material_price_history h
   where h.raw_material_id = p_raw_material_id
     and h.supplier_id     = p_supplier_id
     and h.source          = 'invoice'
     and upper(coalesce(h.currency, 'NOK')) = 'NOK'
     and coalesce(h.is_credit, false)  = false
     and coalesce(h.is_legacy, false)  = false
     and h.superseded_at is null
     and h.price is not null
     and public.rm_is_finite(h.price)
     and h.price >= 0
     and h.effective_date < p_invoice_date
     and (p_invoice_id is null or h.invoice_id is distinct from p_invoice_id)
   order by h.effective_date desc, h.created_at desc, h.id desc
   limit 1;

  if found then
    return jsonb_build_object(
      'source', 'last_purchase',
      'price', v_hist.price,
      'reference_id', v_hist.id,
      'reference_date', v_hist.effective_date,
      'invoice_id', v_hist.invoice_id);
  end if;

  return jsonb_build_object('source', 'none', 'reason', 'ingen_avtale_eller_tidligere_kjop');
end;
$function$;

revoke execute on function public.rm_price_reference(uuid, uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.rm_price_reference(uuid, uuid, uuid, date) to service_role;