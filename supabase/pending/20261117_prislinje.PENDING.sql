-- =====================================================================================
-- PENDING 17.11.2026 · Variant B fase 2 · Prislinje: «Rett pris», «Endre godkjent pakning»,
-- justerbar avviksgrense. Kjøres av root. Bare additivt: to nye kolonner (null = standard),
-- én ny tabell (endringslogg + gjentaksnøkkel) og fire nye funksjoner. Endrer eller sletter
-- INGEN eksisterende data ved kjøring. Ingen eksisterende funksjon endres.
--
--  * invoice_match_settings.price_history_deviation_pct  (null = kategoriens toleranse, som i dag)
--  * invoice_match_settings.price_history_since_months   (null = 12 måneder)
--  * rm_purchase_corrections: én rad per retting (pris/pakning), før/etter, grunn, hvem, når, angret.
--  * rm_correct_purchase_price(history_id, ny_pris, grunn, op_id, dry_run=true)
--      approve/admin. Endrer bare det ene kjøpet: gammel observasjon får superseded_at (beholdes
--      som revisjon; snapshot røres ikke), og en ny manuell observasjon med samme dato,
--      leverandør og fakturahenvisning (invoice_line_ref) legges inn. Gjeldende kost regnes av
--      eksisterende trigger/prisvelger (rm_apply_derived_cost_price). dry_run viser kost før/etter
--      uten å lagre (alt rulles tilbake i en delblokk).
--  * rm_revert_purchase_price_correction(correction_id, grunn)  approve/admin.
--  * rm_change_approved_package(rms_id, størrelse, enhet, grunnenheter, beholder, grunn,
--      expected_updated_at, op_id, dry_run=true)  approve/admin. Endrer leverandørens godkjente
--      pakning framover; tidligere kjøp og prisobservasjoner endres ikke. Forrige variant med samme
--      varenummer og beholder får superseded_at (aldri sletting). Åpne fakturaer med linjer fra
--      koblingen legges i den vanlige omberegningskøen.
--  * rm_cap_prislinje_v1(): frontend viser rettingene bare når denne finnes.
-- =====================================================================================
begin;

alter table public.invoice_match_settings
  add column if not exists price_history_deviation_pct numeric null,
  add column if not exists price_history_since_months integer null;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'ims_price_history_deviation_pct_chk') then
    alter table public.invoice_match_settings add constraint ims_price_history_deviation_pct_chk
      check (price_history_deviation_pct is null or (price_history_deviation_pct >= 0 and price_history_deviation_pct <= 500));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ims_price_history_since_months_chk') then
    alter table public.invoice_match_settings add constraint ims_price_history_since_months_chk
      check (price_history_since_months is null or (price_history_since_months >= 1 and price_history_since_months <= 120));
  end if;
end $c$;

create table if not exists public.rm_purchase_corrections (
  id uuid primary key,                       -- = klientens op_id (gjentaksnøkkel)
  legal_entity_id uuid not null,
  kind text not null check (kind in ('price','package')),
  raw_material_id uuid not null,
  supplier_id uuid null,
  history_id uuid null,
  new_history_id uuid null,
  rms_id uuid null,
  before jsonb not null default '{}'::jsonb,
  after jsonb not null default '{}'::jsonb,
  reason text not null,
  corrected_by uuid not null,
  corrected_at timestamptz not null default now(),
  reverted_at timestamptz null,
  reverted_by uuid null,
  revert_reason text null
);
create index if not exists ix_rm_purchase_corrections_rm on public.rm_purchase_corrections (raw_material_id, corrected_at desc);
create index if not exists ix_rm_purchase_corrections_le on public.rm_purchase_corrections (legal_entity_id, corrected_at desc);
grant select on public.rm_purchase_corrections to authenticated;
grant all on public.rm_purchase_corrections to service_role;
alter table public.rm_purchase_corrections enable row level security;
drop policy if exists rmpc_select on public.rm_purchase_corrections;
create policy rmpc_select on public.rm_purchase_corrections for select to authenticated
  using (public.has_ravarer_invoice_read_or_owner(legal_entity_id));
-- Ingen skrivepolicy: rader skrives bare av funksjonene under (security definer).

create or replace function public.rm_correct_purchase_price(p_history_id uuid, p_new_price numeric, p_reason text, p_op_id uuid, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  h public.raw_material_price_history%rowtype;
  v_rm public.raw_materials%rowtype;
  v_prev public.rm_purchase_corrections%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_new_id uuid; v_cost_before numeric; v_status_before text; v_cost_after numeric; v_status_after text;
  v_invoice_number text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_op_id is null then return jsonb_build_object('ok', false, 'error', 'op_mangler'); end if;
  if not coalesce(p_dry_run, true) then
    select * into v_prev from public.rm_purchase_corrections where id = p_op_id;
    if found then
      if v_prev.kind <> 'price' or v_prev.history_id is distinct from p_history_id or v_prev.corrected_by is distinct from v_uid
         or (v_prev.after->>'price')::numeric is distinct from p_new_price then
        return jsonb_build_object('ok', false, 'error', 'op_gjenbrukt');
      end if;
      return jsonb_build_object('ok', true, 'already', true, 'dry_run', false, 'correction_id', v_prev.id, 'new_history_id', v_prev.new_history_id,
                                'old_price', (v_prev.before->>'price')::numeric, 'new_price', p_new_price);
    end if;
  end if;

  select * into h from public.raw_material_price_history where id = p_history_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'finnes_ikke'); end if;
  select * into v_rm from public.raw_materials where id = h.raw_material_id for update;
  if not found or not coalesce(public.has_ravarer_invoice_approve(v_rm.legal_entity_id), false) then
    raise exception 'Krever godkjenner eller administrator' using errcode = '42501';
  end if;
  if h.superseded_at is not null then return jsonb_build_object('ok', false, 'error', 'allerede_erstattet'); end if;
  if coalesce(h.is_legacy, false) or coalesce(h.is_credit, false) then return jsonb_build_object('ok', false, 'error', 'kan_ikke_rettes'); end if;
  if upper(coalesce(h.snapshot_currency, h.currency, 'NOK')) <> 'NOK' then return jsonb_build_object('ok', false, 'error', 'valuta'); end if;
  if h.snapshot_unit is not null and h.snapshot_unit is distinct from v_rm.base_unit then
    return jsonb_build_object('ok', false, 'error', 'enhet_endret');
  end if;
  if p_new_price is null or not public.rm_is_finite(p_new_price) or p_new_price <= 0 then return jsonb_build_object('ok', false, 'error', 'ugyldig_pris'); end if;
  if p_new_price = h.price then return jsonb_build_object('ok', false, 'error', 'samme_pris'); end if;
  if length(v_reason) < 5 or length(v_reason) > 500 then return jsonb_build_object('ok', false, 'error', 'begrunnelse_mangler'); end if;

  v_cost_before := v_rm.current_cost_price; v_status_before := v_rm.cost_basis_status;
  select invoice_number::text into v_invoice_number from public.invoices where id = h.invoice_id;

  begin
    update public.raw_material_price_history
       set superseded_at = now(), superseded_reason = left('Pris rettet: ' || v_reason, 500)
     where id = h.id;
    insert into public.raw_material_price_history
      (raw_material_id, supplier_id, price, effective_date, source, source_reference, invoice_id, notes, created_by,
       invoice_line_id, invoice_line_ref, currency, is_credit, is_legacy, cost_eligible)
    values
      (h.raw_material_id, h.supplier_id, p_new_price, h.effective_date, 'manual', 'rettet:' || h.id::text, h.invoice_id,
       left('Rettet pris for ett kjøp' || coalesce(' (faktura ' || v_invoice_number || ')', '') || ': ' || v_reason, 1000), v_uid,
       null, coalesce(h.invoice_line_id, h.invoice_line_ref), coalesce(h.currency, 'NOK'), false, false, true)
    returning id into v_new_id;
    select current_cost_price, cost_basis_status into v_cost_after, v_status_after from public.raw_materials where id = h.raw_material_id;
    if coalesce(p_dry_run, true) then raise exception 'rm_dry_run' using errcode = 'P0D01'; end if;
  exception when sqlstate 'P0D01' then
    -- Forhåndsvisning: alt i blokken er rullet tilbake; tallene over beholdes.
    return jsonb_build_object('ok', true, 'dry_run', true, 'old_price', h.price, 'new_price', p_new_price,
      'effective_date', h.effective_date, 'unit', v_rm.base_unit, 'invoice_number', v_invoice_number,
      'cost_before', v_cost_before, 'cost_status_before', v_status_before,
      'cost_after', v_cost_after, 'cost_status_after', v_status_after);
  end;

  insert into public.rm_purchase_corrections (id, legal_entity_id, kind, raw_material_id, supplier_id, history_id, new_history_id, before, after, reason, corrected_by)
  values (p_op_id, v_rm.legal_entity_id, 'price', h.raw_material_id, h.supplier_id, h.id, v_new_id,
          jsonb_build_object('price', h.price, 'effective_date', h.effective_date, 'source', h.source, 'invoice_id', h.invoice_id,
                             'invoice_number', v_invoice_number, 'invoice_line_id', coalesce(h.invoice_line_id, h.invoice_line_ref),
                             'cost', v_cost_before, 'cost_status', v_status_before),
          jsonb_build_object('price', p_new_price, 'history_id', v_new_id, 'cost', v_cost_after, 'cost_status', v_status_after),
          v_reason, v_uid);
  insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'raw_material.purchase_price_corrected', 'raw_material', h.raw_material_id, v_rm.legal_entity_id,
          jsonb_build_object('history_id', h.id, 'new_history_id', v_new_id, 'old_price', h.price, 'new_price', p_new_price,
                             'effective_date', h.effective_date, 'invoice_id', h.invoice_id, 'correction_id', p_op_id),
          v_reason, 'ravarer');
  return jsonb_build_object('ok', true, 'already', false, 'dry_run', false, 'correction_id', p_op_id, 'new_history_id', v_new_id,
    'old_price', h.price, 'new_price', p_new_price, 'cost_before', v_cost_before, 'cost_after', v_cost_after, 'cost_status_after', v_status_after);
end
$fn$;

create or replace function public.rm_revert_purchase_price_correction(p_correction_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  c public.rm_purchase_corrections%rowtype;
  v_orig public.raw_material_price_history%rowtype;
  v_new public.raw_material_price_history%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into c from public.rm_purchase_corrections where id = p_correction_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'finnes_ikke'); end if;
  if not coalesce(public.has_ravarer_invoice_approve(c.legal_entity_id), false) then
    raise exception 'Krever godkjenner eller administrator' using errcode = '42501';
  end if;
  if c.kind <> 'price' then return jsonb_build_object('ok', false, 'error', 'ikke_prisretting'); end if;
  if c.reverted_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  if length(v_reason) < 5 or length(v_reason) > 500 then return jsonb_build_object('ok', false, 'error', 'begrunnelse_mangler'); end if;
  perform 1 from public.raw_materials where id = c.raw_material_id for update;
  select * into v_orig from public.raw_material_price_history where id = c.history_id for update;
  select * into v_new from public.raw_material_price_history where id = c.new_history_id for update;
  if v_orig.id is null or v_new.id is null then return jsonb_build_object('ok', false, 'error', 'finnes_ikke'); end if;
  if v_new.superseded_at is not null then return jsonb_build_object('ok', false, 'error', 'retting_erstattet'); end if;
  if v_orig.superseded_at is null then return jsonb_build_object('ok', false, 'error', 'original_aktiv'); end if;
  if v_orig.invoice_line_id is not null and exists (
       select 1 from public.raw_material_price_history x
        where x.invoice_line_id = v_orig.invoice_line_id and x.superseded_at is null and x.id <> v_orig.id) then
    return jsonb_build_object('ok', false, 'error', 'konflikt');
  end if;
  update public.raw_material_price_history set superseded_at = now(), superseded_reason = left('Retting angret: ' || v_reason, 500)
   where id = v_new.id;
  update public.raw_material_price_history set superseded_at = null, superseded_reason = null where id = v_orig.id;
  update public.rm_purchase_corrections set reverted_at = now(), reverted_by = v_uid, revert_reason = v_reason where id = c.id;
  insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'raw_material.purchase_price_correction_reverted', 'raw_material', c.raw_material_id, c.legal_entity_id,
          jsonb_build_object('correction_id', c.id, 'history_id', c.history_id, 'new_history_id', c.new_history_id), v_reason, 'ravarer');
  return jsonb_build_object('ok', true, 'already', false);
end
$fn$;

create or replace function public.rm_change_approved_package(
  p_rms_id uuid, p_package_size numeric, p_package_unit text, p_base_units_per_package numeric, p_container_unit text,
  p_reason text, p_expected_updated_at timestamptz, p_op_id uuid, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  s public.raw_material_suppliers%rowtype;
  v_rm public.raw_materials%rowtype;
  v_prev public.rm_purchase_corrections%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_unit text := nullif(btrim(coalesce(p_package_unit, '')), '');
  v_container text := nullif(lower(btrim(coalesce(p_container_unit, ''))), '');
  v_lines jsonb; v_open int; v_invoices uuid[]; v_superseded int := 0; v_rematch jsonb := null;
  v_before jsonb; v_after jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_op_id is null then return jsonb_build_object('ok', false, 'error', 'op_mangler'); end if;
  if not coalesce(p_dry_run, true) then
    select * into v_prev from public.rm_purchase_corrections where id = p_op_id;
    if found then
      if v_prev.kind <> 'package' or v_prev.rms_id is distinct from p_rms_id or v_prev.corrected_by is distinct from v_uid
         or (v_prev.after->>'base_units_per_package')::numeric is distinct from p_base_units_per_package then
        return jsonb_build_object('ok', false, 'error', 'op_gjenbrukt');
      end if;
      return jsonb_build_object('ok', true, 'already', true, 'dry_run', false, 'correction_id', v_prev.id);
    end if;
  end if;
  select * into s from public.raw_material_suppliers where id = p_rms_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'finnes_ikke'); end if;
  select * into v_rm from public.raw_materials where id = s.raw_material_id;
  if not found or not coalesce(public.has_ravarer_invoice_approve(v_rm.legal_entity_id), false) then
    raise exception 'Krever godkjenner eller administrator' using errcode = '42501';
  end if;
  if p_expected_updated_at is null or s.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok', false, 'error', 'versjon_endret');
  end if;
  if p_base_units_per_package is null or not public.rm_is_finite(p_base_units_per_package) or p_base_units_per_package <= 0 then
    return jsonb_build_object('ok', false, 'error', 'ugyldig_pakning');
  end if;
  if p_package_size is not null and (not public.rm_is_finite(p_package_size) or p_package_size <= 0) then
    return jsonb_build_object('ok', false, 'error', 'ugyldig_pakning');
  end if;
  if s.package_confirmed_at is not null and s.base_units_per_package = p_base_units_per_package
     and s.package_size is not distinct from p_package_size and lower(coalesce(s.package_unit, '')) = lower(coalesce(v_unit, ''))
     and coalesce(lower(s.container_unit), '') = coalesce(v_container, lower(s.container_unit), '') then
    return jsonb_build_object('ok', false, 'error', 'samme_pakning');
  end if;
  if length(v_reason) < 5 or length(v_reason) > 500 then return jsonb_build_object('ok', false, 'error', 'begrunnelse_mangler'); end if;

  -- Åpne linjer som bruker koblingens pakning: anslag for ny pris per grunnenhet (regnes på nytt i køen).
  select count(*), coalesce(array_agg(distinct il.invoice_id), '{}'),
         coalesce(jsonb_agg(jsonb_build_object('line_id', il.id, 'invoice_id', il.invoice_id, 'invoice_number', i.invoice_number,
                  'invoice_date', i.invoice_date, 'quantity', il.quantity, 'unit', il.unit, 'total_amount', il.total_amount,
                  'price_per_base_unit', il.price_per_base_unit,
                  'new_price_per_base_unit', case when public.rm_is_finite(il.total_amount) and public.rm_is_finite(il.quantity) and il.quantity > 0
                                                  then round(il.total_amount / (il.quantity * p_base_units_per_package), 4) end)
                  order by i.invoice_date, il.id) filter (where true), '[]'::jsonb)
    into v_open, v_invoices, v_lines
    from public.invoice_lines il join public.invoices i on i.id = il.invoice_id
   where il.package_source_rms_id = s.id and il.requires_review
     and i.status in ('imported','needs_review','ready') and i.flagged_at is null;

  v_before := jsonb_build_object('package_size', s.package_size, 'package_unit', s.package_unit, 'base_units_per_package', s.base_units_per_package,
                                 'container_unit', s.container_unit, 'package_confirmed_at', s.package_confirmed_at, 'cost', v_rm.current_cost_price);
  v_after := jsonb_build_object('package_size', p_package_size, 'package_unit', coalesce(v_unit, s.package_unit),
                                'base_units_per_package', p_base_units_per_package, 'container_unit', coalesce(v_container, s.container_unit));
  if coalesce(p_dry_run, true) then
    return jsonb_build_object('ok', true, 'dry_run', true, 'before', v_before, 'after', v_after, 'base_unit', v_rm.base_unit,
      'open_lines', v_open, 'open_invoices', cardinality(v_invoices), 'lines', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(v_lines) x limit 25) t),
      'history_unchanged', true);
  end if;

  update public.raw_material_suppliers
     set package_size = p_package_size, package_unit = coalesce(v_unit, package_unit), base_units_per_package = p_base_units_per_package,
         container_unit = coalesce(v_container, container_unit), package_confirmed_at = now(), package_confirmed_by = v_uid
   where id = s.id;
  -- Forrige godkjente variant for samme varenummer og beholder erstattes (beholdes som historikk).
  update public.raw_material_supplier_packages p
     set superseded_at = now(), superseded_reason = left('Erstattet av endret godkjent pakning: ' || v_reason, 500)
   where p.raw_material_supplier_id = s.id and p.superseded_at is null
     and p.supplier_sku_norm is not distinct from public.rm_sku_norm(s.supplier_sku)
     and coalesce(lower(p.container_unit), '') = coalesce(v_container, lower(s.container_unit), '')
     and not (p.base_units_per_package = p_base_units_per_package
              and coalesce(p.package_size, -1) = coalesce(p_package_size, -1)
              and coalesce(lower(p.package_unit), '') = coalesce(lower(coalesce(v_unit, s.package_unit)), ''));
  get diagnostics v_superseded = row_count;
  if cardinality(v_invoices) > 0 then
    v_rematch := public.rm_rematch_invoices(v_rm.legal_entity_id, least(cardinality(v_invoices), 200), v_invoices, true);
  end if;
  insert into public.rm_purchase_corrections (id, legal_entity_id, kind, raw_material_id, supplier_id, rms_id, before, after, reason, corrected_by)
  values (p_op_id, v_rm.legal_entity_id, 'package', s.raw_material_id, s.supplier_id, s.id, v_before,
          v_after || jsonb_build_object('superseded_variants', v_superseded, 'open_lines', v_open), v_reason, v_uid);
  insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'raw_material_supplier.approved_package_changed', 'raw_material_supplier', s.id, v_rm.legal_entity_id,
          jsonb_build_object('before', v_before, 'after', v_after, 'superseded_variants', v_superseded, 'correction_id', p_op_id), v_reason, 'ravarer');
  return jsonb_build_object('ok', true, 'already', false, 'dry_run', false, 'correction_id', p_op_id, 'open_lines', v_open,
                            'requeued', coalesce((v_rematch->>'queued')::int, 0), 'superseded_variants', v_superseded);
end
$fn$;

create or replace function public.rm_cap_prislinje_v1()
returns boolean language sql stable security invoker set search_path to 'public' as $fn$ select true $fn$;

revoke all on function public.rm_correct_purchase_price(uuid, numeric, text, uuid, boolean) from public, anon;
revoke all on function public.rm_revert_purchase_price_correction(uuid, text) from public, anon;
revoke all on function public.rm_change_approved_package(uuid, numeric, text, numeric, text, text, timestamptz, uuid, boolean) from public, anon;
revoke all on function public.rm_cap_prislinje_v1() from public, anon;
grant execute on function public.rm_correct_purchase_price(uuid, numeric, text, uuid, boolean) to authenticated, service_role;
grant execute on function public.rm_revert_purchase_price_correction(uuid, text) to authenticated, service_role;
grant execute on function public.rm_change_approved_package(uuid, numeric, text, numeric, text, text, timestamptz, uuid, boolean) to authenticated, service_role;
grant execute on function public.rm_cap_prislinje_v1() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
