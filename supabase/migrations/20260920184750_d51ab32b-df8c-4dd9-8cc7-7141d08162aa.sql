-- A/B) Massekobling: låsing før vurdering, komplett kontrollverdi, ingen falsk nullstilling.

drop function if exists public.rm_supplier_link_candidates(uuid);

create or replace function public.rm_supplier_link_candidates(p_rms_id uuid)
returns table(
  line_id uuid,
  invoice_id uuid,
  invoice_number text,
  invoice_date date,
  description text,
  supplier_sku text,
  quantity numeric,
  unit text,
  total_amount numeric,
  package_size numeric,
  package_unit text,
  count_per_package numeric,
  raw_material_id uuid,
  match_confidence text,
  eligible boolean,
  exclusion_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $function$
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

  -- Antall pakninger per kartong slik koblingen beskriver den.
  v_link_count := case
    when v_link.base_units_per_package is not null and coalesce(v_link.package_size, 0) > 0
      then round(v_link.base_units_per_package / v_link.package_size, 6)
    else null end;

  -- Varenummer: både koblingens eget og BEKREFTEDE supplier_sku-aliaser.
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
           public.rm_match_key(l.description)  as name_key
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
  -- Tvetydig: en ANNEN vare hos samme leverandør gjør krav på samme nøkkel,
  -- enten via bekreftet alias ELLER via sitt eget varenummer/produktnavn.
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
        -- Pakning: ulik enhet, ulik størrelse ELLER ulikt antall per kartong
        -- er forskjellige pakninger. Ulik enhet er IKKE et frikort.
        when m.package_size is not null and v_link.package_size is not null
             and (m.package_size <> v_link.package_size
                  or public.rm_match_key(m.package_unit)
                     is distinct from public.rm_match_key(v_link.package_unit)
                  or (m.count_per_package is not null and v_link_count is not null
                      and round(m.count_per_package, 6) <> v_link_count))
          then 'annen_pakning'
        when public.rm_unit_factor(m.unit, v_base_unit) is null
             and (v_link.base_units_per_package is null or v_link.package_confirmed_at is null)
          then 'ukjent_pakning'
        else null
      end as reason
    ) r
   order by m.invoice_date desc, m.invoice_number, m.id;
end;
$function$;

grant execute on function public.rm_supplier_link_candidates(uuid) to authenticated, service_role;

-- Kontrollverdi for forhåndsvisningen: dekker koblingen, aliasene OG linjene.
create or replace function public.rm_supplier_link_snapshot(p_rms_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_link record;
  v_alias text;
  v_lines text;
begin
  select s.*, rm.legal_entity_id as entity_id
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

  select coalesce(string_agg(t, ',' order by t), '')
    into v_lines
    from (
      select c.line_id::text || ':' || c.eligible::text || ':' || coalesce(c.exclusion_reason, '')
             || ':' || coalesce(c.package_size::text, '') || ':' || coalesce(c.package_unit, '')
             || ':' || coalesce(c.count_per_package::text, '')
             || ':' || coalesce(c.raw_material_id::text, '')
             || ':' || coalesce(c.match_confidence, '')
             || ':' || coalesce(c.quantity::text, '') || ':' || coalesce(c.total_amount::text, '') as t
        from public.rm_supplier_link_candidates(p_rms_id) c
    ) y;

  return md5(
    coalesce(v_link.updated_at::text, '') || '|' ||
    coalesce(v_link.supplier_sku, '') || '|' ||
    coalesce(v_link.supplier_product_name, '') || '|' ||
    coalesce(v_link.package_size::text, '') || '|' ||
    coalesce(v_link.package_unit, '') || '|' ||
    coalesce(v_link.base_units_per_package::text, '') || '|' ||
    coalesce(v_link.package_confirmed_at::text, '') || '|' ||
    v_alias || '|' || v_lines);
end;
$function$;

grant execute on function public.rm_supplier_link_snapshot(uuid) to authenticated, service_role;

drop function if exists public.rm_apply_supplier_link_lines(uuid, uuid[], timestamptz);

create or replace function public.rm_apply_supplier_link_lines(
  p_rms_id uuid,
  p_line_ids uuid[],
  p_expected_snapshot text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_link record;
  v_entity uuid;
  v_ids uuid[];
  v_applied uuid[] := '{}';
  v_invoices uuid[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
  v_cand record;
  v_id uuid;
  v_before record;
  v_reasons text;
  v_now text;
begin
  if auth.uid() is null then
    raise exception 'Ikke innlogget';
  end if;
  if p_expected_snapshot is null or btrim(p_expected_snapshot) = '' then
    raise exception 'Mangler kontrollverdi for forhåndsvisningen — hent den på nytt';
  end if;

  select coalesce(array_agg(distinct x), '{}')
    into v_ids
    from unnest(coalesce(p_line_ids, '{}'::uuid[])) x
   where x is not null;
  if array_length(v_ids, 1) is null then
    raise exception 'Ingen linjer valgt';
  end if;

  select s.*, rm.legal_entity_id as entity_id
    into v_link
    from public.raw_material_suppliers s
    join public.raw_materials rm on rm.id = s.raw_material_id
   where s.id = p_rms_id
   for update of s;
  if not found then
    raise exception 'Leverandørkoblingen finnes ikke';
  end if;
  v_entity := v_link.entity_id;

  if not public.has_ravarer_invoice_access(v_entity, 'write') then
    raise exception 'Ingen skrivetilgang til fakturaer for dette selskapet';
  end if;

  -- LÅS fakturaer og linjer FØR vurderingen, slik at ingen kan endre dem
  -- mellom kontrollen og skrivingen.
  perform 1
     from public.invoices i
    where i.id in (select l.invoice_id from public.invoice_lines l where l.id = any (v_ids))
    order by i.id
      for update;
  perform 1
     from public.invoice_lines l
    where l.id = any (v_ids)
    order by l.id
      for update;

  -- Først NÅ er tilstanden stabil: sammenlign kontrollverdien.
  if public.rm_supplier_link_snapshot(p_rms_id) is distinct from p_expected_snapshot then
    raise exception 'Grunnlaget er endret siden forhåndsvisningen — hent den på nytt';
  end if;

  v_now := to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF');

  foreach v_id in array v_ids loop
    select c.* into v_cand
      from public.rm_supplier_link_candidates(p_rms_id) c
     where c.line_id = v_id;

    if not found then
      v_skipped := v_skipped || jsonb_build_object('line_id', v_id, 'reason', 'ikke_lenger_aktuell');
      continue;
    end if;
    if not v_cand.eligible then
      v_skipped := v_skipped || jsonb_build_object('line_id', v_id, 'reason', v_cand.exclusion_reason);
      continue;
    end if;

    select l.raw_material_id, l.match_confidence, l.requires_review, l.review_reason, l.invoice_id
      into v_before
      from public.invoice_lines l
     where l.id = v_id;

    v_invoices := v_invoices || v_before.invoice_id;

    -- Idempotent: allerede koblet manuelt til samme vare → ingen ny skriving.
    if v_before.raw_material_id = v_link.raw_material_id
       and v_before.match_confidence = 'manual' then
      v_applied := v_applied || v_id;
      continue;
    end if;

    -- Vi NULLSTILLER ALDRI eksisterende varsler her. Prisavvik, kreditnota- og
    -- sumproblemer står til matchemotoren har regnet linjen om.
    select coalesce(
             nullif(
               (select string_agg(distinct r, ',')
                  from unnest(
                    string_to_array(coalesce(v_before.review_reason, ''), ',')
                    || array['recalculation_pending']) as t(r)
                 where btrim(coalesce(r, '')) <> ''),
               ''),
             'recalculation_pending')
      into v_reasons;

    update public.invoice_lines l
       set raw_material_id  = v_link.raw_material_id,
           match_confidence = 'manual',
           requires_review  = true,
           review_reason    = v_reasons,
           resolved_by      = auth.uid(),
           resolved_at      = now()
     where l.id = v_id;

    insert into public.audit_log
      (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
    values
      (auth.uid(), 'invoice_line.bulk_link', 'invoice_line', v_id, v_entity,
       jsonb_build_object(
         'old', jsonb_build_object('raw_material_id', v_before.raw_material_id,
                                   'match_confidence', v_before.match_confidence,
                                   'review_reason', v_before.review_reason),
         'new', jsonb_build_object('raw_material_id', v_link.raw_material_id,
                                   'match_confidence', 'manual',
                                   'review_reason', v_reasons)),
       'Bekreftet varekobling brukt på flere linjer (venter på ny prisberegning ' || v_now || ')',
       'ravarer');

    v_applied := v_applied || v_id;
  end loop;

  select coalesce(array_agg(distinct x), '{}') into v_invoices from unnest(v_invoices) x;

  return jsonb_build_object(
    'applied', to_jsonb(v_applied),
    'applied_count', coalesce(array_length(v_applied, 1), 0),
    'skipped', v_skipped,
    'invoice_ids', to_jsonb(v_invoices),
    'recalculation_pending', true,
    'raw_material_id', v_link.raw_material_id);
end;
$function$;

grant execute on function public.rm_apply_supplier_link_lines(uuid, uuid[], text) to authenticated, service_role;

comment on function public.rm_apply_supplier_link_lines(uuid, uuid[], text) is
  'Kobler valgte fakturalinjer til bekreftet leverandørkobling. Låser faktura og linjer før vurdering, krever kontrollverdi fra rm_supplier_link_snapshot, og lar linjene stå som recalculation_pending til match-invoice-lines har regnet dem om.';