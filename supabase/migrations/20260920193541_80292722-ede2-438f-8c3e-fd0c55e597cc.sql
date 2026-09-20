CREATE OR REPLACE FUNCTION public.rm_unit_change_cutoff(p_raw_material_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  -- Historikken lagrer ingen enhet. Endres grunnenheten, kan eldre priser
  -- ikke sammenlignes med nyere. Vi bruker datoen for SISTE endring som skille.
  select max(c.created_at)::date
    from public.raw_material_changelog c
   where c.raw_material_id = p_raw_material_id
     and c.field = 'base_unit'
$function$;

REVOKE ALL ON FUNCTION public.rm_unit_change_cutoff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rm_unit_change_cutoff(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rm_price_reference(p_raw_material_id uuid, p_supplier_id uuid, p_invoice_id uuid, p_invoice_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_first  record;
  v_second record;
  v_hist   record;
  v_entity uuid;
  v_inv    record;
  v_cutoff date;
begin
  if p_raw_material_id is null or p_supplier_id is null or p_invoice_date is null then
    return jsonb_build_object('source', 'none', 'reason', 'mangler_vare_leverandor_eller_dato');
  end if;

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

  if auth.uid() is not null and not public.has_ravarer_invoice_access(v_entity, 'read') then
    raise exception 'Ingen fakturatilgang for dette selskapet';
  end if;

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

  -- Kjøp fra før grunnenheten ble endret er ikke sammenlignbare.
  v_cutoff := public.rm_unit_change_cutoff(p_raw_material_id);

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
     and h.effective_date >= coalesce(v_cutoff, '-infinity'::date)
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

  if v_cutoff is not null then
    return jsonb_build_object('source', 'none', 'reason', 'ingen_sammenlignbare_kjop_etter_enhetsendring');
  end if;

  return jsonb_build_object('source', 'none', 'reason', 'ingen_avtale_eller_tidligere_kjop');
end;
$function$;

CREATE OR REPLACE FUNCTION public.rm_price_summary(p_raw_material_id uuid, p_supplier_id uuid DEFAULT NULL::uuid, p_on_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entity uuid;
  v_agreement jsonb := null;
  v_last jsonb := null;
  v_amount numeric := 0;
  v_qty numeric := 0;
  v_obs int := 0;
  v_suppliers int := 0;
  v_row record;
  v_cutoff date;
begin
  select rm.legal_entity_id into v_entity from public.raw_materials rm where rm.id = p_raw_material_id;
  if v_entity is null then
    raise exception 'Råvaren finnes ikke';
  end if;
  if not public.has_ravarer_access(auth.uid(), v_entity, 'read'::access_level) then
    raise exception 'Ingen råvaretilgang for dette selskapet';
  end if;

  v_cutoff := public.rm_unit_change_cutoff(p_raw_material_id);

  if p_supplier_id is not null then
    select jsonb_build_object(
             'supplier_id', s.supplier_id,
             'price', s.agreed_price_per_base_unit,
             'valid_from', s.agreement_valid_from,
             'valid_to', s.agreement_valid_to,
             'priority', s.agreement_priority)
      into v_agreement
      from public.raw_material_suppliers s
     where s.raw_material_id = p_raw_material_id
       and s.supplier_id = p_supplier_id
       and s.agreed_price_per_base_unit is not null
       and coalesce(s.agreement_valid_from, '-infinity'::date) <= p_on_date
       and coalesce(s.agreement_valid_to,   'infinity'::date)  >= p_on_date
     order by s.agreement_priority asc, coalesce(s.agreement_valid_from, '-infinity'::date) desc, s.id
     limit 1;
  end if;

  select jsonb_build_object(
           'price', h.price,
           'date', h.effective_date,
           'supplier_id', h.supplier_id,
           'invoice_id', h.invoice_id,
           'invoice_line_id', h.invoice_line_id)
    into v_last
    from public.raw_material_price_history h
   where h.raw_material_id = p_raw_material_id
     and (p_supplier_id is null or h.supplier_id = p_supplier_id)
     and h.source = 'invoice'
     and upper(coalesce(h.currency, 'NOK')) = 'NOK'
     and coalesce(h.is_credit, false) = false
     and coalesce(h.is_legacy, false) = false
     and h.superseded_at is null
     and h.effective_date <= p_on_date
     and h.effective_date >= coalesce(v_cutoff, '-infinity'::date)
   order by h.effective_date desc, h.created_at desc, h.id desc
   limit 1;

  for v_row in
    select l.total_amount, l.base_quantity, h.supplier_id
      from public.raw_material_price_history h
      join public.invoice_lines l on l.id = h.invoice_line_id
     where h.raw_material_id = p_raw_material_id
       and (p_supplier_id is null or h.supplier_id = p_supplier_id)
       and h.source = 'invoice'
       and upper(coalesce(h.currency, 'NOK')) = 'NOK'
       and coalesce(h.is_credit, false) = false
       and coalesce(h.is_legacy, false) = false
       and h.superseded_at is null
       and h.effective_date between (p_on_date - 89) and p_on_date
       and h.effective_date >= coalesce(v_cutoff, '-infinity'::date)
       and l.base_quantity is not null and l.base_quantity > 0
       and l.total_amount is not null
       and public.rm_is_finite(l.total_amount)
       and public.rm_is_finite(l.base_quantity)
  loop
    v_amount := v_amount + abs(v_row.total_amount);
    v_qty    := v_qty + v_row.base_quantity;
    v_obs    := v_obs + 1;
  end loop;

  select count(distinct h.supplier_id) into v_suppliers
    from public.raw_material_price_history h
    join public.invoice_lines l on l.id = h.invoice_line_id
   where h.raw_material_id = p_raw_material_id
     and (p_supplier_id is null or h.supplier_id = p_supplier_id)
     and h.superseded_at is null
     and coalesce(h.is_credit, false) = false
     and h.effective_date between (p_on_date - 89) and p_on_date
     and h.effective_date >= coalesce(v_cutoff, '-infinity'::date);

  return jsonb_build_object(
    'agreement', v_agreement,
    'last_purchase', v_last,
    'weighted_90d', case when v_qty > 0 then round(v_amount / v_qty, 6) else null end,
    'weighted_90d_amount', v_amount,
    'weighted_90d_quantity', v_qty,
    'weighted_90d_observations', v_obs,
    'weighted_90d_suppliers', coalesce(v_suppliers, 0),
    'unit_changed_at', v_cutoff,
    'on_date', p_on_date);
end;
$function$;