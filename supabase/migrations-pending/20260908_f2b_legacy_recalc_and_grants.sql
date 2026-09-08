-- F2b / F1 / F3 — opprydding av eksisterende historikk, herdet omregning og rettigheter.
--
-- Rulles ut ETTER 20260908_f2_price_history_linewise.sql (bruker is_credit, is_legacy,
-- superseded_at og invoice_line_id derfra). Ikke kjørt av agenten.
--
-- Live-funn som ligger til grunn (kontrollert 8. sep 2026):
--   * 35 invoice-rader i raw_material_price_history stammer fra kreditnotaer.
--   * 1376 rader har ingen fakturalinje med samsvarende price_per_base_unit i dag.
--   * 12 (faktura, råvare)-grupper har to fakturalinjer.
--   * raw_material_monthly_purchases og raw_material_purchase_stats har SELECT for
--     authenticated. Ingen klient leser dem direkte: appen bruker RPC-ene
--     get_raw_material_purchase_stats / list_raw_material_purchase_stats /
--     list_supplier_purchase_stats, og edge-funksjonen get-purchase-stats-for-range
--     bruker list_monthly_purchases. Revokeringen under er derfor trygg.
--   * rm_apply_matvaretabellen / rm_unlink_matvaretabellen kontrollerte selskap via
--     has_ravarer_access i live-definisjonen, men rettighetene settes eksplisitt her.
--     ACL-en inneholdt ikke anon ved kontroll; revoke er tatt med som vern.

begin;

-- 1) Merk eksisterende historikk. INGEN rader slettes eller endres i verdi. -----

-- 1a) Kreditnotarader er kredithendelser, ikke innkjøpspriser.
update public.raw_material_price_history h
   set is_credit = true,
       is_legacy = true,
       superseded_at = coalesce(h.superseded_at, now()),
       superseded_reason = coalesce(h.superseded_reason, 'kreditnota'),
       notes = coalesce(h.notes, '') ||
               case when coalesce(h.notes, '') = '' then '' else ' | ' end ||
               'Merket som kredithendelse i F2b'
  from public.invoices i
 where i.id = h.invoice_id
   and h.source = 'invoice'
   and coalesce(i.is_credit_note, false)
   and h.is_credit = false;

-- 1b) Rader uten fakturalinje som i dag har samme pris per grunnenhet regnes som
--     utdatert grunnlag: de beholdes, men teller ikke som gjeldende prishendelse.
update public.raw_material_price_history h
   set is_legacy = true,
       superseded_at = coalesce(h.superseded_at, now()),
       superseded_reason = coalesce(h.superseded_reason, 'uten_linjegrunnlag')
 where h.source = 'invoice'
   and h.invoice_line_id is null
   and not exists (
     select 1
       from public.invoice_lines il
      where il.invoice_id = h.invoice_id
        and il.raw_material_id = h.raw_material_id
        and il.price_per_base_unit is not null
        and il.price_per_base_unit = h.price
   );

-- 1c) Der en faktura/råvare har FLERE linjer, kan en gammel enkeltrad ikke
--     representere kjøpet. Den settes til side; linjeradene skrives av
--     fn_rm_price_history_upsert_line.
update public.raw_material_price_history h
   set is_legacy = true,
       superseded_at = coalesce(h.superseded_at, now()),
       superseded_reason = coalesce(h.superseded_reason, 'flere_linjer')
 where h.source = 'invoice'
   and h.invoice_line_id is null
   and (
     select count(*)
       from public.invoice_lines il
      where il.invoice_id = h.invoice_id
        and il.raw_material_id = h.raw_material_id
   ) > 1;

-- 2) Herdet omregning av kostpris (F2/F6) -----------------------------------
-- Endringer mot live v-versjonen:
--   * kreditnota, ikke-NOK, linjer til gjennomgang og flaggede fakturaer holdes utenfor
--   * kostpris og prishistorikk skrives aldri over en manuell overstyring
create or replace function public.recalc_raw_material_cost(
  p_raw_material_id uuid,
  p_dry_run boolean default true,
  p_reason text default null,
  p_override_material_factor numeric default null,
  p_override_supplier_id uuid default null,
  p_override_supplier_factor numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rm record; v_stored_mat numeric; v_factor numeric; v_factor_src text;
  v_sup_factor numeric; v_changes jsonb := '[]'::jsonb; v_snapshot jsonb := '[]'::jsonb;
  v_line record; v_new record;
  v_n_total int := 0; v_n_changed int := 0; v_n_unknown int := 0; v_n_outlier int := 0;
  v_n_excluded int := 0;
  v_cost_before numeric; v_cost_after numeric; v_median numeric;
  v_recalc_id uuid; v_latest_date date; v_last_factor numeric; v_last_src text;
  v_manual boolean;
begin
  if auth.uid() is null then
    raise exception 'Du må være innlogget' using errcode = '28000';
  end if;
  if not public.rm_can_write(p_raw_material_id) then
    raise exception 'Ingen skrivetilgang til denne råvaren' using errcode = '42501';
  end if;

  select id, name, base_unit, current_cost_price, base_units_per_package, price_source
    into v_rm from public.raw_materials where id = p_raw_material_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'Råvaren finnes ikke'); end if;

  v_manual := coalesce(v_rm.price_source, '') = 'manual';
  v_cost_before := v_rm.current_cost_price;
  v_stored_mat := coalesce(p_override_material_factor, v_rm.base_units_per_package);

  -- Hvor mange linjer holdes utenfor grunnlaget, og hvorfor.
  select count(*) into v_n_excluded
    from public.invoice_lines il
    join public.invoices i on i.id = il.invoice_id
   where il.raw_material_id = p_raw_material_id
     and coalesce(il.match_confidence::text, '') <> 'not_applicable'
     and (coalesce(i.is_credit_note, false)
          or upper(coalesce(i.currency, 'NOK')) <> 'NOK'
          or coalesce(il.requires_review, false)
          or i.flagged_at is not null);

  for v_line in
    select il.id, il.quantity, il.unit, il.total_amount, il.description,
           il.base_quantity as old_bq, il.price_per_base_unit as old_ppb,
           i.invoice_date, i.supplier_id, i.invoice_number
      from public.invoice_lines il
      join public.invoices i on i.id = il.invoice_id
     where il.raw_material_id = p_raw_material_id
       and coalesce(il.match_confidence::text, '') <> 'not_applicable'
       -- Kreditnota er ingen innkjøpspris.
       and coalesce(i.is_credit_note, false) = false
       -- Vi omregner ikke valuta.
       and upper(coalesce(i.currency, 'NOK')) = 'NOK'
       -- Linjer som venter på gjennomgang er ikke et gyldig grunnlag.
       and coalesce(il.requires_review, false) = false
       -- Flagget faktura holdes utenfor til den er avklart.
       and i.flagged_at is null
       -- Leverandøren må høre til fakturaens selskap.
       and exists (select 1 from public.suppliers s
                    where s.id = i.supplier_id and s.legal_entity_id = i.legal_entity_id)
     order by i.invoice_date, il.id
  loop
    v_n_total := v_n_total + 1;

    if p_override_supplier_id is not null
       and v_line.supplier_id = p_override_supplier_id
       and p_override_supplier_factor is not null then
      v_sup_factor := p_override_supplier_factor;
    else
      select rms.base_units_per_package into v_sup_factor
        from public.raw_material_suppliers rms
       where rms.raw_material_id = p_raw_material_id
         and rms.supplier_id = v_line.supplier_id
         and rms.base_units_per_package is not null;
    end if;

    if v_sup_factor is not null then
      v_factor := v_sup_factor; v_factor_src := 'leverandor';
    elsif v_stored_mat is not null then
      v_factor := v_stored_mat; v_factor_src := 'ravare';
    else
      v_factor := null; v_factor_src := null;
    end if;
    v_last_factor := v_factor; v_last_src := v_factor_src;

    select * into v_new
      from public.rm_line_base(v_line.quantity, v_line.unit, v_line.total_amount,
                               v_rm.base_unit, v_factor);

    if v_new.base_quantity is null then v_n_unknown := v_n_unknown + 1; end if;

    if v_new.price_per_base_unit is distinct from v_line.old_ppb
       or v_new.base_quantity is distinct from v_line.old_bq then
      v_n_changed := v_n_changed + 1;
      v_snapshot := v_snapshot || jsonb_build_object(
        'line_id', v_line.id, 'base_quantity', v_line.old_bq, 'price_per_base_unit', v_line.old_ppb);
    end if;

    v_changes := v_changes || jsonb_build_object(
      'line_id', v_line.id, 'invoice_date', v_line.invoice_date,
      'invoice_number', v_line.invoice_number, 'description', v_line.description,
      'quantity', v_line.quantity, 'unit', v_line.unit, 'total_amount', v_line.total_amount,
      'old_ppb', v_line.old_ppb, 'new_ppb', v_new.price_per_base_unit,
      'new_base_qty', v_new.base_quantity, 'method', v_new.method,
      'factor', v_factor, 'factor_source', v_factor_src);

    if not p_dry_run and v_new.base_quantity is not null then
      update public.invoice_lines
         set base_quantity = v_new.base_quantity,
             price_per_base_unit = v_new.price_per_base_unit
       where id = v_line.id;
    end if;
  end loop;

  select percentile_cont(0.5) within group (order by (c->>'new_ppb')::numeric)
    into v_median from jsonb_array_elements(v_changes) c where c->>'new_ppb' is not null;

  if v_median > 0 then
    select jsonb_agg(
             c || jsonb_build_object(
               'avvik_pct', case when c->>'new_ppb' is null then null
                            else round((((c->>'new_ppb')::numeric / v_median) - 1) * 100, 1) end,
               'outlier', case when c->>'new_ppb' is null then false
                          else abs((c->>'new_ppb')::numeric / v_median - 1) > 0.25 end)
             order by (c->>'invoice_date')::date, c->>'line_id')
      into v_changes from jsonb_array_elements(v_changes) c;
    select count(*) into v_n_outlier
      from jsonb_array_elements(v_changes) c where (c->>'outlier')::boolean;
  end if;

  select (c->>'new_ppb')::numeric, (c->>'invoice_date')::date
    into v_cost_after, v_latest_date
    from jsonb_array_elements(v_changes) c
   where c->>'new_ppb' is not null and not coalesce((c->>'outlier')::boolean, false)
   order by (c->>'invoice_date')::date desc, c->>'line_id' desc limit 1;

  if v_cost_after is null then
    select (c->>'new_ppb')::numeric, (c->>'invoice_date')::date
      into v_cost_after, v_latest_date
      from jsonb_array_elements(v_changes) c
     where c->>'new_ppb' is not null
     order by (c->>'invoice_date')::date desc, c->>'line_id' desc limit 1;
  end if;

  if not p_dry_run then
    insert into public.raw_material_cost_recalcs(
      raw_material_id, performed_by, reason, factor_used, factor_source,
      lines_changed, cost_before, cost_after, snapshot)
    values (p_raw_material_id, auth.uid(), p_reason, v_last_factor, v_last_src,
            v_n_changed, v_cost_before, case when v_manual then v_cost_before else v_cost_after end,
            v_snapshot)
    returning id into v_recalc_id;

    -- Manuell kostpris overstyres ALDRI av en omregning.
    if not v_manual and v_cost_after is not null and v_cost_after is distinct from v_cost_before then
      update public.raw_materials
         set current_cost_price = v_cost_after,
             -- Hendelsens dato, ikke now(): ellers ødelegges eldre/nyere-sammenligningen.
             price_updated_at = coalesce(v_latest_date::timestamptz, now()),
             price_source = 'invoice'
       where id = p_raw_material_id
         and coalesce(price_source, '') <> 'manual';

      insert into public.raw_material_price_history(
        raw_material_id, price, effective_date, source, source_reference, notes, created_by, currency)
      values (p_raw_material_id, v_cost_after, coalesce(v_latest_date, current_date),
              'recalc', v_recalc_id::text,
              coalesce(p_reason, 'Omregnet etter endret pakningsstørrelse'), auth.uid(), 'NOK');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'dry_run', p_dry_run, 'recalc_id', v_recalc_id,
    'raw_material', v_rm.name, 'base_unit', v_rm.base_unit,
    'factor', v_last_factor, 'factor_source', v_last_src,
    'lines_total', v_n_total, 'lines_changed', v_n_changed,
    'lines_unknown', v_n_unknown, 'lines_outlier', v_n_outlier,
    'lines_excluded', v_n_excluded,
    'manual_cost_protected', v_manual,
    'ppb_median', round(v_median, 4),
    'cost_before', v_cost_before,
    'cost_after', case when v_manual then v_cost_before else v_cost_after end,
    'changes', v_changes);
end;
$function$;

-- 3) Angrestien: samme vern, og historikk settes til side i stedet for å slettes
create or replace function public.undo_raw_material_recalc(p_recalc_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_r record; v_item jsonb; v_n int := 0; v_manual boolean;
begin
  if auth.uid() is null then
    raise exception 'Du må være innlogget' using errcode = '28000';
  end if;
  select * into v_r from public.raw_material_cost_recalcs where id = p_recalc_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Omregningen finnes ikke'); end if;
  if not public.rm_can_write(v_r.raw_material_id) then
    raise exception 'Ingen skrivetilgang til denne råvaren' using errcode = '42501';
  end if;
  if v_r.undone_at is not null then
    return jsonb_build_object('ok', false, 'error', 'Allerede angret');
  end if;

  select coalesce(price_source, '') = 'manual' into v_manual
    from public.raw_materials where id = v_r.raw_material_id;

  for v_item in select * from jsonb_array_elements(v_r.snapshot) loop
    update public.invoice_lines
       set base_quantity = nullif(v_item->>'base_quantity', '')::numeric,
           price_per_base_unit = nullif(v_item->>'price_per_base_unit', '')::numeric
     where id = (v_item->>'line_id')::uuid;
    v_n := v_n + 1;
  end loop;

  if not v_manual then
    update public.raw_materials
       set current_cost_price = v_r.cost_before,
           price_updated_at = now()
     where id = v_r.raw_material_id
       and coalesce(price_source, '') <> 'manual';
  end if;

  -- Historikken beholdes, men settes til side slik at den ikke teller.
  update public.raw_material_price_history
     set is_legacy = true,
         superseded_at = coalesce(superseded_at, now()),
         superseded_reason = coalesce(superseded_reason, 'angret_omregning')
   where source = 'recalc' and source_reference = p_recalc_id::text;

  update public.raw_material_cost_recalcs
     set undone_at = now(), undone_by = auth.uid()
   where id = p_recalc_id;

  return jsonb_build_object('ok', true, 'lines_restored', v_n,
                            'cost_restored', case when v_manual then null else v_r.cost_before end,
                            'manual_cost_protected', v_manual);
end;
$function$;

-- 4) Rettigheter (F1/F3) -----------------------------------------------------
-- Statistikkvisningene nås bare gjennom de tilgangskontrollerte RPC-ene.
revoke select on public.raw_material_monthly_purchases from anon, authenticated;
revoke select on public.raw_material_purchase_stats from anon, authenticated;
grant select on public.raw_material_monthly_purchases to service_role;
grant select on public.raw_material_purchase_stats to service_role;

revoke all on function public.rm_apply_matvaretabellen(uuid, text) from public, anon;
revoke all on function public.rm_unlink_matvaretabellen(uuid) from public, anon;
grant execute on function public.rm_apply_matvaretabellen(uuid, text) to authenticated, service_role;
grant execute on function public.rm_unlink_matvaretabellen(uuid) to authenticated, service_role;

revoke all on function public.recalc_raw_material_cost(uuid, boolean, text, numeric, uuid, numeric) from public, anon;
revoke all on function public.undo_raw_material_recalc(uuid) from public, anon;
grant execute on function public.recalc_raw_material_cost(uuid, boolean, text, numeric, uuid, numeric) to authenticated, service_role;
grant execute on function public.undo_raw_material_recalc(uuid) to authenticated, service_role;

commit;
