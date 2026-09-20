-- Pakning tolket ut av varenavnet, f.eks. «Mel 12x1kg» -> {count:12, size:1, unit:kg}.
CREATE OR REPLACE FUNCTION public.rm_parse_package_text(p_text text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN m IS NULL THEN NULL ELSE jsonb_build_object(
    'count', replace(m[1], ',', '.')::numeric,
    'size',  replace(m[2], ',', '.')::numeric,
    'unit',  m[3]) END
  FROM regexp_match(
    lower(coalesce(p_text, '')),
    '([0-9]+(?:[.,][0-9]+)?)\s*[x\u00d7]\s*([0-9]+(?:[.,][0-9]+)?)\s*(kg|g|l|dl|cl|ml|stk)'
  ) AS m;
$function$;

REVOKE EXECUTE ON FUNCTION public.rm_parse_package_text(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rm_parse_package_text(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rm_supplier_link_candidates(p_rms_id uuid)
 RETURNS TABLE(line_id uuid, invoice_id uuid, invoice_number text, invoice_date date, description text, supplier_sku text, quantity numeric, unit text, total_amount numeric, package_size numeric, package_unit text, count_per_package numeric, raw_material_id uuid, match_confidence text, eligible boolean, exclusion_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_link record;
  v_entity uuid;
  v_base_unit text;
  v_sku_keys text[];
  v_name_keys text[];
  v_link_count numeric;
begin
  select s.*, rm.legal_entity_id as entity_id, rm.base_unit as base_unit
    into v_link
    from public.raw_material_suppliers s
    join public.raw_materials rm on rm.id = s.raw_material_id
   where s.id = p_rms_id;
  if not found then
    raise exception 'Leverandørkoblingen finnes ikke';
  end if;
  v_entity := v_link.entity_id;
  v_base_unit := v_link.base_unit;
  if not public.has_ravarer_invoice_access(v_entity, 'read') then
    raise exception 'Ingen fakturatilgang for dette selskapet';
  end if;

  v_link_count := case
    when v_link.base_units_per_package is not null and coalesce(v_link.package_size, 0) > 0
      then round(v_link.base_units_per_package / v_link.package_size, 6)
    else null end;

  select coalesce(array_agg(distinct k) filter (where k is not null), '{}')
    into v_sku_keys
    from (
      select nullif(public.rm_match_key(v_link.supplier_sku), '') as k
      union all
      select nullif(public.rm_match_key(a.alias_value), '')
        from public.raw_material_supplier_aliases a
       where a.raw_material_supplier_id = p_rms_id
         and a.status = 'confirmed'
         and a.alias_type in ('supplier_sku', 'ean', 'gtin')
    ) s;

  select coalesce(array_agg(distinct k) filter (where k is not null), '{}')
    into v_name_keys
    from (
      select nullif(public.rm_match_key(v_link.supplier_product_name), '') as k
      union all
      select nullif(public.rm_match_key(a.alias_value), '')
        from public.raw_material_supplier_aliases a
       where a.raw_material_supplier_id = p_rms_id
         and a.status = 'confirmed'
         and a.alias_type = 'product_name'
    ) s;

  return query
  with matched as (
    select l.id, l.invoice_id, l.description, l.supplier_sku, l.quantity, l.unit,
           l.total_amount, l.package_size, l.package_unit, l.count_per_package,
           l.raw_material_id, l.match_confidence,
           i.invoice_number, i.invoice_date, i.status as invoice_status, i.flagged_at,
           i.is_credit_note, i.currency,
           public.rm_match_key(l.supplier_sku) as sku_key,
           public.rm_match_key(l.description)  as name_key,
           public.rm_parse_package_text(l.description) as desc_pkg
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
     where i.supplier_id = v_link.supplier_id
       and i.legal_entity_id = v_entity
       and (
         (array_length(v_sku_keys, 1) is not null
            and public.rm_match_key(l.supplier_sku) = any (v_sku_keys))
         or (array_length(v_name_keys, 1) is not null
            and public.rm_match_key(l.description) = any (v_name_keys))
       )
  ),
  ambiguous as (
    select m.id
      from matched m
      join public.raw_material_supplier_aliases a2
        on a2.status = 'confirmed'
       and public.rm_match_key(a2.alias_value) in (m.sku_key, m.name_key)
      join public.raw_material_suppliers s2 on s2.id = a2.raw_material_supplier_id
     where s2.supplier_id = v_link.supplier_id
       and s2.raw_material_id <> v_link.raw_material_id
    union
    select m.id
      from matched m
      join public.raw_material_suppliers s3
        on s3.supplier_id = v_link.supplier_id
       and s3.raw_material_id <> v_link.raw_material_id
       and (
         nullif(public.rm_match_key(s3.supplier_sku), '') in (m.sku_key, m.name_key)
         or nullif(public.rm_match_key(s3.supplier_product_name), '') in (m.sku_key, m.name_key)
       )
  )
  select m.id, m.invoice_id, m.invoice_number, m.invoice_date, m.description, m.supplier_sku,
         m.quantity, m.unit, m.total_amount,
         m.package_size, m.package_unit, m.count_per_package,
         m.raw_material_id, m.match_confidence,
         (r.reason is null) as eligible,
         r.reason
    from matched m
    cross join lateral (
      select case
        when m.invoice_status in ('reconciled', 'flagged', 'cancelled') then 'faktura_last'
        when m.flagged_at is not null then 'faktura_flagget'
        when coalesce(m.is_credit_note, false) then 'kreditnota'
        when upper(coalesce(m.currency, 'NOK')) <> 'NOK' then 'annen_valuta'
        when m.match_confidence = 'not_applicable' then 'merket_ikke_aktuell'
        when m.raw_material_id is not null and m.raw_material_id <> v_link.raw_material_id
             and m.match_confidence = 'manual' then 'koblet_til_annen_vare'
        when exists (select 1 from ambiguous am where am.id = m.id) then 'tvetydig_alias'
        when m.package_size is not null and v_link.package_size is not null
             and (m.package_size <> v_link.package_size
                  or public.rm_match_key(m.package_unit)
                     is distinct from public.rm_match_key(v_link.package_unit)
                  or (m.count_per_package is not null and v_link_count is not null
                      and round(m.count_per_package, 6) <> v_link_count))
          then 'annen_pakning'
        -- Pakning beskrevet i varenavnet («12x1kg») som ikke stemmer med
        -- koblingen er en ANNEN vare, ikke en stille godkjent kobling.
        when v_link.package_size is not null and m.desc_pkg is not null
             and (
               public.rm_match_key(m.desc_pkg->>'unit') is distinct from public.rm_match_key(v_link.package_unit)
                 and public.rm_match_key(m.desc_pkg->>'unit') is distinct from public.rm_match_key(v_base_unit)
               or (m.desc_pkg->>'size')::numeric <> v_link.package_size
               or (v_link_count is not null and (m.desc_pkg->>'count')::numeric <> v_link_count)
             )
          then 'annen_pakning_beskrivelse'
        when public.rm_unit_factor(m.unit, v_base_unit) is null
             and (v_link.base_units_per_package is null or v_link.package_confirmed_at is null)
          then 'ukjent_pakning'
        else null
      end as reason
    ) r
   order by m.invoice_date desc, m.invoice_number, m.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rm_supplier_link_snapshot(p_rms_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_link record;
  v_alias text;
  v_lines text;
begin
  select s.*, rm.legal_entity_id as entity_id, rm.base_unit as base_unit
    into v_link
    from public.raw_material_suppliers s
    join public.raw_materials rm on rm.id = s.raw_material_id
   where s.id = p_rms_id;
  if not found then
    raise exception 'Leverandørkoblingen finnes ikke';
  end if;
  if not public.has_ravarer_invoice_access(v_link.entity_id, 'read') then
    raise exception 'Ingen fakturatilgang for dette selskapet';
  end if;

  select coalesce(string_agg(t, ',' order by t), '')
    into v_alias
    from (
      select a.id::text || ':' || a.alias_type::text || ':' || a.status::text || ':'
             || coalesce(a.alias_value, '') as t
        from public.raw_material_supplier_aliases a
       where a.raw_material_supplier_id = p_rms_id
    ) x;

  -- Kontrollverdien må dekke ALT forhåndsvisningen bygger på. Endres enhet,
  -- beskrivelse, varenummer eller fakturaens tilstand, er grunnlaget utdatert.
  select coalesce(string_agg(t, ',' order by t), '')
    into v_lines
    from (
      select c.line_id::text || ':' || c.eligible::text || ':' || coalesce(c.exclusion_reason, '')
             || ':' || coalesce(c.package_size::text, '') || ':' || coalesce(c.package_unit, '')
             || ':' || coalesce(c.count_per_package::text, '')
             || ':' || coalesce(c.raw_material_id::text, '')
             || ':' || coalesce(c.match_confidence, '')
             || ':' || coalesce(c.quantity::text, '') || ':' || coalesce(c.total_amount::text, '')
             || ':' || coalesce(c.unit, '')
             || ':' || coalesce(c.description, '')
             || ':' || coalesce(c.supplier_sku, '')
             || ':' || coalesce(c.invoice_id::text, '')
             || ':' || coalesce(c.invoice_number, '')
             || ':' || coalesce(c.invoice_date::text, '')
             || ':' || coalesce(l.updated_at::text, '')
             || ':' || coalesce(i.status, '')
             || ':' || coalesce(upper(i.currency), '')
             || ':' || coalesce(i.flagged_at::text, '')
             || ':' || coalesce(i.is_credit_note::text, '') as t
        from public.rm_supplier_link_candidates(p_rms_id) c
        join public.invoice_lines l on l.id = c.line_id
        join public.invoices i on i.id = c.invoice_id
    ) y;

  return md5(
    coalesce(v_link.updated_at::text, '') || '|' ||
    coalesce(v_link.supplier_sku, '') || '|' ||
    coalesce(v_link.supplier_product_name, '') || '|' ||
    coalesce(v_link.package_size::text, '') || '|' ||
    coalesce(v_link.package_unit, '') || '|' ||
    coalesce(v_link.base_units_per_package::text, '') || '|' ||
    coalesce(v_link.package_confirmed_at::text, '') || '|' ||
    coalesce(v_link.base_unit, '') || '|' ||
    v_alias || '|' || v_lines);
end;
$function$;

-- Prissammenligning skal kreve faktisk lesetilgang til råvarer, ikke bare en
-- stilling i selskapet.
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
begin
  select rm.legal_entity_id into v_entity from public.raw_materials rm where rm.id = p_raw_material_id;
  if v_entity is null then
    raise exception 'Råvaren finnes ikke';
  end if;
  if not public.has_ravarer_access(auth.uid(), v_entity, 'read'::access_level) then
    raise exception 'Ingen råvaretilgang for dette selskapet';
  end if;

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
     and h.effective_date between (p_on_date - 89) and p_on_date;

  return jsonb_build_object(
    'agreement', v_agreement,
    'last_purchase', v_last,
    'weighted_90d', case when v_qty > 0 then round(v_amount / v_qty, 6) else null end,
    'weighted_90d_amount', v_amount,
    'weighted_90d_quantity', v_qty,
    'weighted_90d_observations', v_obs,
    'weighted_90d_suppliers', coalesce(v_suppliers, 0),
    'on_date', p_on_date);
end;
$function$;