-- =====================================================================================
-- DATAENDRING 19.11.2026 · Demo D «Fra faktura til vare» · opprydding av åpne linjer
-- Forutsetter 20261119_fra_faktura.PENDING.sql. Kjøres av root etter Henriks uttrykkelige ja.
--
-- Filen lager ÉN funksjon, rm_fra_faktura_cleanup(le, dry_run = true). Selve opprettelsen endrer
-- ingen data. Standard er dry-run: svaret viser antall linjer per årsak og per leverandør som ville
-- blitt endret, og ingenting lagres.
--
-- Med p_dry_run = false (bare approve/admin, og bare når de nye reglene er slått på i
-- invoice_match_settings) gjør den to ting:
--   A) Skrivemåter: alle navn leverandøren har brukt for allerede koblede leverandørvarer blir
--      bekreftede navnealias (samme regel som rm_remember_supplier_item_names). Avviste alias røres ikke.
--   B) Fakturaer med åpne linjer som de nye reglene ville løst (pris under grensen, entydig pakning lest
--      fra fakturaen) legges i den vanlige omberegningskøen (rm_rematch_invoices). Selve løsningen gjøres
--      av matchingen med de nye reglene – samme kode som for nye fakturaer. Ingen linje endres direkte her.
-- Ingenting slettes. Låste, godkjente, flaggede, avstemte fakturaer og linjer med ført kost hoppes over.
-- =====================================================================================
begin;

create or replace function public.rm_fra_faktura_cleanup(p_legal_entity_id uuid, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_limit numeric; v_quiet boolean; v_pkg boolean;
  v_by_reason jsonb; v_by_supplier jsonb; v_invoices uuid[]; v_aliases int := 0; v_queue jsonb := null;
begin
  if v_uid is null then raise exception 'Krever pålogging' using errcode = '28000'; end if;
  if not coalesce(public.has_ravarer_invoice_approve(p_legal_entity_id), false) then
    raise exception 'Krever godkjennerrettighet' using errcode = '42501';
  end if;
  select coalesce(price_jump_pct, 20), coalesce(fra_faktura_quiet_prices, false), coalesce(fra_faktura_invoice_package, false)
    into v_limit, v_quiet, v_pkg from public.invoice_match_settings where legal_entity_id = p_legal_entity_id;
  v_limit := coalesce(v_limit, 20);

  drop table if exists _ff;
  create temp table _ff on commit drop as
  with open_lines as (
    select il.id, il.invoice_id, i.supplier_id, s.name as supplier_name, il.raw_material_id, il.price_variance_pct,
           il.package_size, il.package_unit, il.review_reason,
           string_to_array(coalesce(il.review_reason, ''), ',') as reasons,
           coalesce(rm.price_jump_pct, v_limit) as lim,
           rms.package_confirmed_at
      from public.invoice_lines il
      join public.invoices i on i.id = il.invoice_id
      left join public.suppliers s on s.id = i.supplier_id
      left join public.raw_materials rm on rm.id = il.raw_material_id
      left join public.raw_material_suppliers rms on rms.raw_material_id = il.raw_material_id and rms.supplier_id = i.supplier_id
     where i.legal_entity_id = p_legal_entity_id and il.requires_review and il.excluded_at is null
       and i.status in ('imported','needs_review','ready') and i.flagged_at is null and i.reconciled_at is null
       and not exists (select 1 from public.invoice_internal_approvals a where a.invoice_id = i.id and a.status = 'approved' and a.revoked_at is null)
       and not exists (select 1 from public.invoice_line_cost_postings p where p.invoice_line_id = il.id and p.revoked_at is null)
  )
  select id, invoice_id, supplier_id, supplier_name,
         case
           when raw_material_id is not null
                and reasons <@ array['price_variance','price_increase','price_drop','no_automatic_basis']
                and ((price_variance_pct is not null and abs(price_variance_pct) <= lim)
                     or (price_variance_pct is null and package_confirmed_at is not null and reasons <@ array['no_automatic_basis']))
             then 'pris_under_grense'
           when raw_material_id is not null and reasons <@ array['unknown_package_size']
                and package_size is not null and package_size > 0 and coalesce(btrim(package_unit), '') <> ''
             then 'pakning_fra_faktura'
           else null end as reason
    from open_lines;

  select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) into v_by_reason
    from (select reason, count(*) n from _ff where reason is not null group by 1) t;
  select coalesce(jsonb_agg(jsonb_build_object('supplier_id', supplier_id, 'supplier', supplier_name, 'reason', reason, 'lines', n) order by n desc), '[]'::jsonb)
    into v_by_supplier
    from (select supplier_id, supplier_name, reason, count(*) n from _ff where reason is not null group by 1, 2, 3) t;
  select coalesce(array_agg(distinct invoice_id), '{}') into v_invoices from _ff where reason is not null;

  -- A) skrivemåter som mangler som bekreftede navnealias
  drop table if exists _ff_names;
  create temp table _ff_names on commit drop as
  select distinct rms.id as rms_id, btrim(il.description) as name, i.supplier_id
    from public.invoice_lines il
    join public.invoices i on i.id = il.invoice_id
    join public.raw_material_suppliers rms on rms.raw_material_id = il.raw_material_id and rms.supplier_id = i.supplier_id
   where i.legal_entity_id = p_legal_entity_id and il.raw_material_id is not null
     and il.match_confidence in ('manual','auto_high') and coalesce(btrim(il.description), '') <> ''
     and not exists (select 1 from public.raw_material_supplier_aliases a
                      where a.raw_material_supplier_id = rms.id and a.alias_type = 'product_name'
                        and lower(btrim(a.alias_value)) = lower(btrim(il.description)));

  if not coalesce(p_dry_run, true) then
    if not (v_quiet or v_pkg) then
      return jsonb_build_object('ok', false, 'reason', 'regler_av',
        'message', 'Slå på de nye reglene i Fra faktura før oppryddingen kjøres.');
    end if;
    with ins as (
      insert into public.raw_material_supplier_aliases (raw_material_supplier_id, alias_type, alias_value, status, confirmed_by, confirmed_at, match_count, last_seen_at)
      select rms_id, 'product_name', name, 'confirmed', v_uid, now(), 1, now() from _ff_names
      on conflict (alias_type, alias_value_normalized, raw_material_supplier_id) do nothing
      returning 1)
    select count(*) into v_aliases from ins;
    if cardinality(v_invoices) > 0 then
      v_queue := public.rm_rematch_invoices(p_legal_entity_id, cardinality(v_invoices), v_invoices, true);
    end if;
    insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
    values (v_uid, 'fra_faktura.cleanup', 'legal_entity', p_legal_entity_id, p_legal_entity_id,
            jsonb_build_object('by_reason', v_by_reason, 'invoices', cardinality(v_invoices), 'aliases_added', v_aliases),
            'Fra faktura: opprydding etter nye regler', 'ravarer');
  end if;

  return jsonb_build_object(
    'ok', true, 'dry_run', coalesce(p_dry_run, true),
    'rules', jsonb_build_object('price_jump_pct', v_limit, 'quiet_prices', v_quiet, 'invoice_package', v_pkg),
    'lines_by_reason', v_by_reason, 'lines_by_supplier', v_by_supplier,
    'invoices', cardinality(v_invoices),
    'names_to_remember', (select count(*) from _ff_names),
    'names_by_supplier', (select coalesce(jsonb_object_agg(coalesce(s.name, 'ukjent'), n), '{}'::jsonb)
                            from (select supplier_id, count(*) n from _ff_names group by 1) t left join public.suppliers s on s.id = t.supplier_id),
    'aliases_added', v_aliases, 'queue', v_queue);
end $$;

revoke all on function public.rm_fra_faktura_cleanup(uuid, boolean) from public, anon;
grant execute on function public.rm_fra_faktura_cleanup(uuid, boolean) to authenticated, service_role;

-- Linjeskift: limes filen inn med Windows-linjeskift (CR+LF), får funksjonene over et usynlig CR-tegn i kroppen.
-- Denne blokken skriver dem på nytt med bare LF, slik at kontrollsummene blir de samme uansett innliming.
-- Gjør ingenting når alt allerede er LF. Rører bare funksjonene denne filen oppretter.
do $lf$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = any (array['rm_fra_faktura_cleanup'])
              and p.prokind = 'f' and strpos(p.prosrc, chr(13)) > 0 loop
    execute replace(pg_get_functiondef(r.oid), chr(13), '');
  end loop;
end $lf$;

commit;

-- Forhåndsvisning (endrer ingenting), som innlogget approve/admin:
--   select public.rm_fra_faktura_cleanup('<legal_entity_id>'::uuid, true);
-- Kjøring (DATAENDRING – bare etter Henriks ja, og etter at reglene er slått på i Fra faktura):
--   select public.rm_fra_faktura_cleanup('<legal_entity_id>'::uuid, false);
