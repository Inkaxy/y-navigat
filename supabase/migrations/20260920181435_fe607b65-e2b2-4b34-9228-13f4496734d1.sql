-- 1) Hvilket prisgrunnlag avviket faktisk ble regnet mot.
alter table public.invoice_lines
  add column if not exists price_reference_source text,
  add column if not exists price_reference_id uuid,
  add column if not exists price_reference_date date;

comment on column public.invoice_lines.price_reference_source is
  'agreement | last_purchase | none | conflict — hvilket grunnlag prisavviket ble målt mot.';
comment on column public.invoice_lines.price_reference_id is
  'raw_material_suppliers.id ved avtale, raw_material_price_history.id ved forrige kjøp.';
comment on column public.invoice_lines.price_reference_date is
  'Datoen grunnlaget gjaldt fra (avtale) eller ble observert (forrige kjøp).';

-- 2) Normaliseringsnøkkel som speiler matchNormalize.ts i frontend/edge.
create or replace function public.rm_match_key(p text)
returns text
language sql
immutable
set search_path = public
as $function$
  select case when s ~ '^[0-9]+$' then regexp_replace(s, '^0+(?=[0-9])', '') else s end
  from (
    select btrim(regexp_replace(
             regexp_replace(
               translate(lower(coalesce(p, '')),
                         'áàâäãçéèêëíìîïñóòôöõúùûüý',
                         'aaaaaceeeeiiiinoooouuuuy'),
               '[^[:alnum:]æøå]+', ' ', 'g'),
             '\s+', ' ', 'g')) as s
  ) t
$function$;

comment on function public.rm_match_key(text) is
  'Normalisert sammenligningsnøkkel for leverandør-SKU og produktnavn. Speiler normalizeMatchKey i TypeScript.';

-- 3) Deterministisk valg av prisgrunnlag for én fakturalinje.
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
set search_path = public
as $function$
declare
  v_first  record;
  v_second record;
  v_hist   record;
begin
  if p_raw_material_id is null or p_supplier_id is null or p_invoice_date is null then
    return jsonb_build_object('source', 'none', 'reason', 'mangler_vare_leverandor_eller_dato');
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

    -- To likestilte avtaler med ulik pris: vi VELGER IKKE. Linjen må avklares.
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

  -- (b) Forrige kontrollerte kjøp: samme vare og leverandør, NOK, ikke kreditnota,
  --     ikke pensjonert, STRENGT før denne fakturaen, og aldri fakturaen selv.
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

grant execute on function public.rm_price_reference(uuid, uuid, uuid, date) to authenticated, service_role;

-- 4) Prisoversikt: avtale, siste kontrollerte kjøp og mengdevektet 90-dagerssnitt.
create or replace function public.rm_price_summary(
  p_raw_material_id uuid,
  p_supplier_id uuid default null,
  p_on_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
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
  if not public.has_position_in_entity(v_entity) then
    raise exception 'Ingen tilgang til denne råvaren';
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

  -- Mengdevektet snitt = sum(beløp) / sum(mengde). ALDRI snitt av priser.
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

grant execute on function public.rm_price_summary(uuid, uuid, date) to authenticated, service_role;

-- 5) Hvilke åpne linjer kan få samme varekobling? Forhåndsvisning med begrunnelse.
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
  v_sku_key text;
  v_name_keys text[];
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

  v_sku_key := nullif(public.rm_match_key(v_link.supplier_sku), '');

  select coalesce(array_agg(distinct public.rm_match_key(a.alias_value))
                  filter (where nullif(public.rm_match_key(a.alias_value), '') is not null), '{}')
    into v_name_keys
    from public.raw_material_supplier_aliases a
   where a.raw_material_supplier_id = p_rms_id
     and a.status = 'confirmed'
     and a.alias_type = 'product_name';

  if nullif(public.rm_match_key(v_link.supplier_product_name), '') is not null then
    v_name_keys := v_name_keys || public.rm_match_key(v_link.supplier_product_name);
  end if;

  return query
  with matched as (
    select l.id, l.invoice_id, l.description, l.supplier_sku, l.quantity, l.unit,
           l.total_amount, l.package_size, l.package_unit, l.raw_material_id, l.match_confidence,
           i.invoice_number, i.invoice_date, i.status as invoice_status,
           i.is_credit_note, i.currency,
           public.rm_match_key(l.supplier_sku) as sku_key,
           public.rm_match_key(l.description)  as name_key
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
     where i.supplier_id = v_link.supplier_id
       and i.legal_entity_id = v_entity
       and (
         (v_sku_key is not null and public.rm_match_key(l.supplier_sku) = v_sku_key)
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
  )
  select m.id, m.invoice_id, m.invoice_number, m.invoice_date, m.description, m.supplier_sku,
         m.quantity, m.unit, m.total_amount,
         (r.reason is null) as eligible,
         r.reason
    from matched m
    cross join lateral (
      select case
        when m.invoice_status in ('reconciled', 'flagged', 'cancelled') then 'faktura_last'
        when coalesce(m.is_credit_note, false) then 'kreditnota'
        when upper(coalesce(m.currency, 'NOK')) <> 'NOK' then 'annen_valuta'
        when m.match_confidence = 'not_applicable' then 'merket_ikke_aktuell'
        when m.raw_material_id is not null and m.raw_material_id <> v_link.raw_material_id
             and m.match_confidence = 'manual' then 'koblet_til_annen_vare'
        when exists (select 1 from ambiguous am where am.id = m.id) then 'tvetydig_alias'
        when m.package_size is not null and v_link.package_size is not null
             and public.rm_match_key(m.package_unit) is not distinct from public.rm_match_key(v_link.package_unit)
             and m.package_size <> v_link.package_size then 'annen_pakning'
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

-- 6) Bruk koblingen på de valgte linjene — atomisk, idempotent og etterprøvd.
create or replace function public.rm_apply_supplier_link_lines(
  p_rms_id uuid,
  p_line_ids uuid[],
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_link record;
  v_entity uuid;
  v_applied uuid[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
  v_cand record;
  v_id uuid;
  v_before record;
begin
  if auth.uid() is null then
    raise exception 'Ikke innlogget';
  end if;
  if p_line_ids is null or array_length(p_line_ids, 1) is null then
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

  -- Er koblingen endret etter at brukeren så forhåndsvisningen, avbryter vi.
  if p_expected_updated_at is not null
     and date_trunc('milliseconds', v_link.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'Leverandørkoblingen er endret av noen andre — hent forhåndsvisningen på nytt';
  end if;

  foreach v_id in array p_line_ids loop
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

    select l.raw_material_id, l.match_confidence, l.requires_review, l.review_reason
      into v_before
      from public.invoice_lines l
     where l.id = v_id
     for update;

    -- Idempotent: en linje som allerede står slik, telles som brukt uten ny skriving.
    if v_before.raw_material_id = v_link.raw_material_id
       and v_before.match_confidence = 'manual'
       and coalesce(v_before.requires_review, false) = false then
      v_applied := v_applied || v_id;
      continue;
    end if;

    update public.invoice_lines l
       set raw_material_id  = v_link.raw_material_id,
           match_confidence = 'manual',
           requires_review  = false,
           review_reason    = null,
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
                                   'match_confidence', 'manual')),
       'Bekreftet varekobling brukt på flere linjer', 'ravarer');

    v_applied := v_applied || v_id;
  end loop;

  return jsonb_build_object(
    'applied', to_jsonb(v_applied),
    'applied_count', coalesce(array_length(v_applied, 1), 0),
    'skipped', v_skipped,
    'raw_material_id', v_link.raw_material_id);
end;
$function$;

grant execute on function public.rm_apply_supplier_link_lines(uuid, uuid[], timestamptz) to authenticated, service_role;

-- 7) Prishistorikk: loggfør senere rettinger av SAMME fakturalinje med gammel og ny verdi.
create or replace function public.fn_rm_price_history_upsert_line(p_line_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_l invoice_lines%rowtype;
  v_inv invoices%rowtype;
  v_sup_entity uuid;
  v_rm_entity uuid;
  v_reason text;
  v_prev record;
begin
  select * into v_l from public.invoice_lines where id = p_line_id;
  if not found then return false; end if;

  select * into v_inv from public.invoices where id = v_l.invoice_id;
  if not found then return false; end if;

  if v_l.raw_material_id is null then
    v_reason := 'linje_ukoblet';
  elsif coalesce(v_l.match_confidence::text, '') = 'not_applicable' then
    v_reason := 'linje_ukoblet';
  elsif coalesce(v_l.match_confidence::text, '') not in ('auto_high', 'auto_medium', 'auto_low', 'manual') then
    v_reason := 'ukjent_match';
  elsif coalesce(v_l.requires_review, false) then
    v_reason := 'til_gjennomgang';
  elsif v_inv.status not in ('ready', 'reconciled') then
    v_reason := 'faktura_ikke_klar';
  elsif upper(coalesce(v_inv.currency, 'NOK')) <> 'NOK' then
    v_reason := 'valuta_endret';
  elsif v_inv.flagged_at is not null then
    v_reason := 'faktura_flagget';
  elsif not public.rm_is_finite(v_l.price_per_base_unit) or v_l.price_per_base_unit < 0 then
    v_reason := 'ugyldig_pris';
  elsif not coalesce(v_inv.is_credit_note, false)
        and v_l.base_quantity is not null
        and (not public.rm_is_finite(v_l.base_quantity) or v_l.base_quantity < 0) then
    v_reason := 'ugyldig_mengde';
  end if;

  if v_reason is null then
    select legal_entity_id into v_rm_entity from public.raw_materials where id = v_l.raw_material_id;
    if v_rm_entity is null or v_rm_entity <> v_inv.legal_entity_id then
      v_reason := 'annet_selskap';
    else
      select legal_entity_id into v_sup_entity from public.suppliers where id = v_inv.supplier_id;
      if v_inv.supplier_id is null or v_sup_entity is null or v_sup_entity <> v_inv.legal_entity_id then
        v_reason := 'leverandor_annet_selskap';
      end if;
    end if;
  end if;

  if v_reason is not null then
    update public.raw_material_price_history
       set superseded_at = coalesce(superseded_at, now()),
           superseded_reason = coalesce(superseded_reason, v_reason)
     where invoice_line_id = p_line_id
       and superseded_at is null;
    return false;
  end if;

  -- Tilstanden FØR rettingen — grunnlaget for revisjonssporet.
  select h.id, h.price, h.raw_material_id, h.supplier_id, h.effective_date
    into v_prev
    from public.raw_material_price_history h
   where h.invoice_line_id = p_line_id;

  insert into public.raw_material_price_history
    (raw_material_id, supplier_id, price, source, invoice_id, invoice_line_id, invoice_line_ref,
     effective_date, source_reference, currency, is_credit, created_by)
  values
    (v_l.raw_material_id, v_inv.supplier_id, v_l.price_per_base_unit, 'invoice',
     v_inv.id, v_l.id, v_l.id, v_inv.invoice_date, v_inv.invoice_number, 'NOK',
     coalesce(v_inv.is_credit_note, false), auth.uid())
  on conflict (invoice_line_id) where invoice_line_id is not null
  do update set
     raw_material_id  = excluded.raw_material_id,
     supplier_id      = excluded.supplier_id,
     price            = excluded.price,
     effective_date   = excluded.effective_date,
     source_reference = excluded.source_reference,
     is_credit        = excluded.is_credit,
     currency         = 'NOK',
     superseded_at    = null,
     superseded_reason = null;

  -- Fremtidige rettinger av samme historikkrad logges med gammel og ny verdi.
  if v_prev.id is not null
     and (v_prev.price is distinct from v_l.price_per_base_unit
          or v_prev.raw_material_id is distinct from v_l.raw_material_id
          or v_prev.supplier_id is distinct from v_inv.supplier_id
          or v_prev.effective_date is distinct from v_inv.invoice_date) then
    insert into public.audit_log
      (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
    values
      (auth.uid(), 'price_history.corrected', 'raw_material_price_history', v_prev.id,
       v_inv.legal_entity_id,
       jsonb_build_object(
         'old', jsonb_build_object('price', v_prev.price, 'raw_material_id', v_prev.raw_material_id,
                                   'supplier_id', v_prev.supplier_id, 'effective_date', v_prev.effective_date),
         'new', jsonb_build_object('price', v_l.price_per_base_unit, 'raw_material_id', v_l.raw_material_id,
                                   'supplier_id', v_inv.supplier_id, 'effective_date', v_inv.invoice_date),
         'invoice_line_id', p_line_id),
       'Prisobservasjon rettet fra fakturalinjen', 'ravarer');
  end if;

  update public.raw_material_price_history h
     set is_legacy = true,
         superseded_at = coalesce(h.superseded_at, now()),
         superseded_reason = coalesce(h.superseded_reason, 'ny_linjerad')
   where h.invoice_id = v_inv.id
     and h.raw_material_id = v_l.raw_material_id
     and h.invoice_line_id is null
     and h.source = 'invoice';

  return true;
end;
$function$;