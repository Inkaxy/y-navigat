-- 0. Speil av live-migrasjon ravarer_review_revoke_anonymous_rpc_access (idempotent)
REVOKE EXECUTE ON FUNCTION public.rm_repair_invoice_vat(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rm_repair_invoice_vat_batch(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rm_work_summary(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rm_repair_invoice_vat(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rm_repair_invoice_vat_batch(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rm_work_summary(uuid, boolean) TO authenticated, service_role;

-- 1. Oslo-dato
CREATE OR REPLACE FUNCTION public.rm_oslo_today() RETURNS date LANGUAGE sql STABLE SET search_path TO 'public'
AS $$ select (now() at time zone 'Europe/Oslo')::date $$;

-- 2. Felles kandidatliste (eneste prisvelger)
CREATE OR REPLACE FUNCTION public._rm_cost_candidates(p_raw_material_id uuid, p_as_of date)
RETURNS TABLE(history_id uuid, price numeric, effective_date date, created_at timestamptz, source text,
              supplier_id uuid, invoice_id uuid, invoice_line_id uuid, invoice_number text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select h.id, h.price, h.effective_date, h.created_at, h.source, h.supplier_id, h.invoice_id, h.invoice_line_id, i.invoice_number::text
    from raw_material_price_history h
    join raw_materials rm on rm.id = h.raw_material_id
    left join invoices i on i.id = h.invoice_id
    left join invoice_lines il on il.id = h.invoice_line_id
    left join suppliers s on s.id = h.supplier_id
   where h.raw_material_id = p_raw_material_id
     and h.effective_date is not null and h.effective_date <= p_as_of
     and not coalesce(h.is_credit, false) and not coalesce(h.is_legacy, false) and h.superseded_at is null
     and upper(coalesce(h.currency, 'NOK')) = 'NOK'
     and public.rm_is_finite(h.price) and h.price > 0
     and (h.supplier_id is null or s.legal_entity_id = rm.legal_entity_id)
     and (
       (h.source = 'invoice' and il.id is not null and i.id is not null
         and il.invoice_id = i.id and il.raw_material_id = h.raw_material_id
         and i.legal_entity_id = rm.legal_entity_id
         and coalesce(il.match_confidence::text, '') in ('auto_high','auto_medium','auto_low','manual')
         and not coalesce(il.requires_review, false)
         and il.base_quantity is not null and il.base_quantity > 0
         and not coalesce(i.is_credit_note, false) and i.flagged_at is null
         and upper(coalesce(i.currency, 'NOK')) = 'NOK'
         and coalesce(i.status, '') <> 'cancelled'
         and (i.status in ('ready','reconciled')
              or exists (select 1 from invoice_line_cost_postings pp where pp.invoice_line_id = il.id and pp.revoked_at is null)
              or public.rm_invoice_lines_trusted(i))
         and (i.status = 'reconciled' or coalesce(i.lines_sum_status, '') <> 'mismatch')
         and not public.rm_invoice_has_read_issues(i.id))
       or (h.source in ('manual','agreement','price_list') and h.invoice_line_id is null
           and h.created_by is not null and length(btrim(coalesce(h.notes, ''))) >= 3)
     )
   order by h.effective_date desc, h.created_at desc, h.id desc
$$;
REVOKE EXECUTE ON FUNCTION public._rm_cost_candidates(uuid, date) FROM PUBLIC, anon, authenticated;

-- 3. Avledet kostpris: nyeste gyldige, ingen datovakt, ingen permanent manuell frys
CREATE OR REPLACE FUNCTION public.rm_apply_derived_cost_price(p_raw_material_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_rm raw_materials%rowtype; c record; v_src text; v_at timestamptz;
begin
  select * into v_rm from raw_materials where id = p_raw_material_id for update;
  if not found then return null; end if;
  select * into c from public._rm_cost_candidates(p_raw_material_id, public.rm_oslo_today()) limit 1;
  -- Ingen gyldig kilde: behold prisen (vises som uverifisert), aldri null.
  if c.history_id is null then return v_rm.current_cost_price; end if;
  -- Eldre manuell pris uten dokumentert historikk vinner bare når den er nyere enn kandidaten.
  if coalesce(v_rm.price_source, '') = 'manual' and v_rm.price_updated_at is not null
     and c.effective_date < (v_rm.price_updated_at at time zone 'Europe/Oslo')::date
     and not exists (select 1 from raw_material_price_history h where h.raw_material_id = p_raw_material_id
                      and h.source in ('manual','agreement','price_list') and h.created_by is not null) then
    return v_rm.current_cost_price;
  end if;
  v_src := case when c.source = 'invoice' then 'invoice' else 'manual' end;
  v_at := (c.effective_date::timestamp at time zone 'Europe/Oslo');
  if v_rm.current_cost_price is not distinct from c.price and v_rm.price_source is not distinct from v_src
     and v_rm.price_updated_at is not distinct from v_at then
    return c.price;
  end if;
  update raw_materials set current_cost_price = c.price, price_updated_at = v_at, price_source = v_src, updated_at = now()
   where id = p_raw_material_id;
  if v_rm.current_cost_price is distinct from c.price then
    insert into audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
    values (auth.uid(), 'raw_material.cost_price_derived', 'raw_material', v_rm.id, v_rm.name, v_rm.legal_entity_id,
            jsonb_build_object('old', v_rm.current_cost_price, 'new', c.price, 'history_id', c.history_id,
                               'invoice_id', c.invoice_id, 'supplier_id', c.supplier_id, 'effective_date', c.effective_date, 'source', c.source),
            'Nyeste gyldige pris', 'ravarer');
  end if;
  return c.price;
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.rm_apply_derived_cost_price(uuid) FROM PUBLIC, anon, authenticated;

-- 4. Gjeldende kilde (lesing)
CREATE OR REPLACE FUNCTION public.rm_cost_price_source(p_raw_material_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_rm raw_materials%rowtype; c record; f record; v_status text; v_sup text;
begin
  if auth.uid() is null or not public.rm_can_read(p_raw_material_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_rm from raw_materials where id = p_raw_material_id;
  if not found then raise exception 'finnes_ikke' using errcode = 'P0002'; end if;
  select * into c from public._rm_cost_candidates(p_raw_material_id, public.rm_oslo_today()) limit 1;
  select * into f from public._rm_cost_candidates(p_raw_material_id, '9999-12-31'::date) x
   where x.effective_date > public.rm_oslo_today() order by x.effective_date asc, x.created_at asc limit 1;
  if c.history_id is not null then select name into v_sup from suppliers where id = c.supplier_id; end if;
  v_status := case
    when c.history_id is null and v_rm.current_cost_price is null then 'mangler'
    when c.history_id is null then 'uverifisert'
    when v_rm.current_cost_price is null or round(v_rm.current_cost_price, 4) <> round(c.price, 4) then 'avviker'
    else 'ok' end;
  return jsonb_build_object(
    'status', v_status, 'current_price', v_rm.current_cost_price, 'base_unit', v_rm.base_unit,
    'price_source', v_rm.price_source, 'price_updated_at', v_rm.price_updated_at,
    'source', case when c.history_id is null then null else jsonb_build_object(
       'history_id', c.history_id, 'price', c.price, 'effective_date', c.effective_date, 'source', c.source,
       'supplier_id', c.supplier_id, 'supplier_name', v_sup, 'invoice_id', c.invoice_id,
       'invoice_line_id', c.invoice_line_id, 'invoice_number', c.invoice_number) end,
    'next', case when f.history_id is null then null else jsonb_build_object('price', f.price, 'effective_date', f.effective_date, 'source', f.source) end);
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.rm_cost_price_source(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rm_cost_price_source(uuid) TO authenticated, service_role;

-- 5. Avviksoversikt
CREATE OR REPLACE FUNCTION public.rm_cost_price_deviations(p_legal_entity_id uuid)
RETURNS TABLE(raw_material_id uuid, name text, base_unit text, current_price numeric, price_source text,
              status text, source_price numeric, source_date date, source_kind text, supplier_name text,
              invoice_id uuid, invoice_number text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or not (p_legal_entity_id in (select public.current_user_entity_ids()))
     or public.app_access_level('ravarer') = 'none' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select r.id, r.name::text, r.base_unit::text, r.current_cost_price, r.price_source::text,
         case when c.history_id is null then 'uverifisert' else 'avviker' end,
         c.price, c.effective_date, c.source, s.name::text, c.invoice_id, c.invoice_number
    from raw_materials r
    left join lateral (select * from public._rm_cost_candidates(r.id, public.rm_oslo_today()) limit 1) c on true
    left join suppliers s on s.id = c.supplier_id
   where r.legal_entity_id = p_legal_entity_id and r.is_active
     and ((c.history_id is null and r.current_cost_price is not null)
          or (c.history_id is not null and (r.current_cost_price is null or round(r.current_cost_price, 4) <> round(c.price, 4))))
   order by r.name;
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.rm_cost_price_deviations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rm_cost_price_deviations(uuid) TO authenticated, service_role;

-- 6. Eksplisitt oppdatering (brukerhandling)
CREATE OR REPLACE FUNCTION public.rm_refresh_cost_prices(p_raw_material_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_id uuid; v_before numeric; v_after numeric; v_items jsonb := '[]'::jsonb; v_changed int := 0;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if coalesce(cardinality(p_raw_material_ids), 0) = 0 or cardinality(p_raw_material_ids) > 500 then
    raise exception 'Velg 1–500 råvarer' using errcode = '22023';
  end if;
  foreach v_id in array p_raw_material_ids loop
    if not public.rm_can_write(v_id) then raise exception 'Ingen skrivetilgang til råvaren' using errcode = '42501'; end if;
    select current_cost_price into v_before from raw_materials where id = v_id;
    v_after := public.rm_apply_derived_cost_price(v_id);
    if v_before is distinct from v_after then v_changed := v_changed + 1; end if;
    v_items := v_items || jsonb_build_object('raw_material_id', v_id, 'before', v_before, 'after', v_after);
  end loop;
  return jsonb_build_object('ok', true, 'changed', v_changed, 'items', v_items);
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.rm_refresh_cost_prices(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rm_refresh_cost_prices(uuid[]) TO authenticated, service_role;

-- 7. Manuell dokumentert pris (atomisk)
CREATE OR REPLACE FUNCTION public.rm_set_documented_cost_price(p_raw_material_id uuid, p_price numeric, p_effective_date date,
  p_reason text, p_supplier_id uuid DEFAULT NULL, p_source text DEFAULT 'manual')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_rm raw_materials%rowtype; v_id uuid; v_cur numeric; v_today date := public.rm_oslo_today();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.rm_can_write(p_raw_material_id) then raise exception 'forbidden: Ingen skrivetilgang til råvaren' using errcode = '42501'; end if;
  select * into v_rm from raw_materials where id = p_raw_material_id for update;
  if not found then raise exception 'finnes_ikke' using errcode = 'P0002'; end if;
  if p_price is null or not public.rm_is_finite(p_price) or p_price <= 0 then raise exception 'ugyldig_pris: Prisen må være større enn 0' using errcode = '22023'; end if;
  if p_effective_date is null or p_effective_date < date '2000-01-01' or p_effective_date > v_today + 366 then
    raise exception 'ugyldig_dato: Datoen må være satt og høyst ett år frem i tid' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'begrunnelse: Skriv en begrunnelse (minst 3 tegn)' using errcode = '22023'; end if;
  if coalesce(p_source, '') not in ('manual','agreement','price_list') then raise exception 'ugyldig_kilde' using errcode = '22023'; end if;
  if p_supplier_id is not null and not exists (select 1 from suppliers s where s.id = p_supplier_id and s.legal_entity_id = v_rm.legal_entity_id) then
    raise exception 'forbidden: Leverandøren tilhører et annet selskap' using errcode = '42501';
  end if;
  insert into raw_material_price_history (raw_material_id, supplier_id, price, effective_date, source, notes, created_by, currency, is_credit)
  values (p_raw_material_id, p_supplier_id, p_price, p_effective_date, p_source, btrim(p_reason), v_uid, 'NOK', false)
  returning id into v_id;
  insert into audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'raw_material.cost_price_documented', 'raw_material', v_rm.id, v_rm.name, v_rm.legal_entity_id,
          jsonb_build_object('history_id', v_id, 'price', p_price, 'effective_date', p_effective_date, 'supplier_id', p_supplier_id, 'source', p_source),
          btrim(p_reason), 'ravarer');
  v_cur := public.rm_apply_derived_cost_price(p_raw_material_id);
  return jsonb_build_object('ok', true, 'history_id', v_id, 'current_price', v_cur,
    'future', p_effective_date > v_today,
    'is_current', v_cur is not distinct from p_price and p_effective_date <= v_today);
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.rm_set_documented_cost_price(uuid, numeric, date, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rm_set_documented_cost_price(uuid, numeric, date, text, uuid, text) TO authenticated, service_role;

-- 8. Dagsjobb: fremtidige priser som er blitt gyldige
CREATE OR REPLACE FUNCTION public.rm_activate_due_cost_prices()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare r record; n int := 0;
begin
  if auth.uid() is not null then raise exception 'forbidden' using errcode = '42501'; end if;
  for r in select distinct h.raw_material_id from raw_material_price_history h
            where h.effective_date between public.rm_oslo_today() - 3 and public.rm_oslo_today()
              and h.created_at::date < h.effective_date and h.superseded_at is null loop
    perform public.rm_apply_derived_cost_price(r.raw_material_id);
    n := n + 1;
  end loop;
  return n;
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.rm_activate_due_cost_prices() FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (select 1 from cron.job where jobname = 'rm-activate-due-cost-prices') THEN
    PERFORM cron.unschedule('rm-activate-due-cost-prices');
  END IF;
  PERFORM cron.schedule('rm-activate-due-cost-prices', '7 * * * *', 'select public.rm_activate_due_cost_prices()');
END $$;

-- 9. Grunnenhet endret: gamle observasjoner er ikke sammenlignbare
CREATE OR REPLACE FUNCTION public._rm_base_unit_cutoff() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if new.base_unit is distinct from old.base_unit then
    update raw_material_price_history set superseded_at = coalesce(superseded_at, now()),
           superseded_reason = coalesce(superseded_reason, 'enhet_endret')
     where raw_material_id = new.id and superseded_at is null;
    insert into audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
    values (auth.uid(), 'raw_material.base_unit_changed', 'raw_material', new.id, new.name, new.legal_entity_id,
            jsonb_build_object('old', old.base_unit, 'new', new.base_unit), 'Prisobservasjoner før enhetsbyttet teller ikke lenger', 'ravarer');
  end if;
  return new;
end;
$function$;
REVOKE EXECUTE ON FUNCTION public._rm_base_unit_cutoff() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_raw_materials_base_unit_cutoff ON public.raw_materials;
CREATE TRIGGER trg_raw_materials_base_unit_cutoff AFTER UPDATE OF base_unit ON public.raw_materials
  FOR EACH ROW EXECUTE FUNCTION public._rm_base_unit_cutoff();

-- 10. Oppskrift: ingen gram→liter-gjetting (samme regel som appen)
CREATE OR REPLACE FUNCTION public.recipe_line_base_qty(p_quantity numeric, p_unit text, p_quantity_grams numeric, p_base_unit text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
declare v_f numeric; v_g numeric;
begin
  v_f := public.rm_unit_factor(p_unit, p_base_unit);
  if v_f is not null and p_quantity is not null then return p_quantity * v_f; end if;
  -- Pris per volum krever mengde i volum; vekt regnes ikke om uten tetthet.
  if lower(btrim(coalesce(p_base_unit, 'kg'))) in ('l','ml','dl','cl') then return null; end if;
  v_g := public.recipe_line_grams(p_quantity, p_unit, p_quantity_grams);
  if v_g is null then return null; end if;
  return case lower(btrim(coalesce(p_base_unit, 'kg'))) when 'kg' then v_g / 1000 when 'g' then v_g else null end;
end $function$;

-- 11. Reberegn: ingen outlier-regel, førte linjer låst, historisk pakning fra linjen/entydig variant
CREATE OR REPLACE FUNCTION public.recalc_raw_material_cost(p_raw_material_id uuid, p_dry_run boolean DEFAULT true, p_reason text DEFAULT NULL::text,
  p_override_material_factor numeric DEFAULT NULL::numeric, p_override_supplier_id uuid DEFAULT NULL::uuid, p_override_supplier_factor numeric DEFAULT NULL::numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_rm record; v_stored_mat numeric; v_factor numeric; v_factor_src text;
  v_changes jsonb := '[]'::jsonb; v_snapshot jsonb := '[]'::jsonb; v_line record; v_new record;
  v_n_total int := 0; v_n_changed int := 0; v_n_unknown int := 0; v_n_locked int := 0; v_n_excluded int := 0;
  v_cost_before numeric; v_cost_after numeric; v_median numeric; v_recalc_id uuid;
  v_last_factor numeric; v_last_src text; v_rms record; v_variants int; v_variant numeric; v_locked boolean;
begin
  if auth.uid() is null then raise exception 'Du må være innlogget' using errcode = '28000'; end if;
  if not public.rm_can_write(p_raw_material_id) then raise exception 'Ingen skrivetilgang til denne råvaren' using errcode = '42501'; end if;
  select id, name, base_unit, current_cost_price, base_units_per_package, price_source into v_rm from raw_materials where id = p_raw_material_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'Råvaren finnes ikke'); end if;
  v_cost_before := v_rm.current_cost_price;
  v_stored_mat := coalesce(p_override_material_factor, v_rm.base_units_per_package);

  select count(*) into v_n_excluded from invoice_lines il join invoices i on i.id = il.invoice_id
   where il.raw_material_id = p_raw_material_id and coalesce(il.match_confidence::text, '') <> 'not_applicable'
     and (coalesce(i.is_credit_note, false) or upper(coalesce(i.currency, 'NOK')) <> 'NOK' or coalesce(il.requires_review, false) or i.flagged_at is not null);

  if not p_dry_run then perform set_config('rm.defer_stats', 'on', true); end if;

  for v_line in
    select il.id, il.quantity, il.unit, il.total_amount, il.description, il.package_size, il.package_unit, il.count_per_package,
           il.base_quantity as old_bq, il.price_per_base_unit as old_ppb, i.invoice_date, i.supplier_id, i.invoice_number
      from invoice_lines il join invoices i on i.id = il.invoice_id
     where il.raw_material_id = p_raw_material_id and coalesce(il.match_confidence::text, '') <> 'not_applicable'
       and coalesce(i.is_credit_note, false) = false and upper(coalesce(i.currency, 'NOK')) = 'NOK'
       and coalesce(il.requires_review, false) = false and i.flagged_at is null
       and exists (select 1 from suppliers s where s.id = i.supplier_id and s.legal_entity_id = i.legal_entity_id)
     order by i.invoice_date, il.id
  loop
    v_n_total := v_n_total + 1;
    v_locked := exists (select 1 from invoice_line_cost_postings pp where pp.invoice_line_id = v_line.id and pp.revoked_at is null);
    v_factor := null; v_factor_src := null;
    -- 1) Linjens egen dokumenterte pakning (historisk korrekt)
    if v_line.package_size is not null and v_line.package_size > 0 and v_line.package_unit is not null then
      v_factor := public.rm_read_unit_factor(v_line.package_unit, v_rm.base_unit) * v_line.package_size * coalesce(nullif(v_line.count_per_package, 0), 1);
      if v_factor is not null then v_factor_src := 'linje'; end if;
    end if;
    if v_factor is null then
      select rms.id, rms.base_units_per_package, rms.package_confirmed_at into v_rms
        from raw_material_suppliers rms where rms.raw_material_id = p_raw_material_id and rms.supplier_id = v_line.supplier_id;
      select count(*), min(v.base_units_per_package) into v_variants, v_variant
        from raw_material_supplier_packages v where v.raw_material_supplier_id = v_rms.id and v.base_units_per_package is not null;
      if p_override_supplier_id is not null and v_line.supplier_id = p_override_supplier_id and p_override_supplier_factor is not null and coalesce(v_variants, 0) <= 1 then
        v_factor := p_override_supplier_factor; v_factor_src := 'leverandor';
      elsif v_variants = 1 then
        v_factor := v_variant; v_factor_src := 'variant';
      elsif coalesce(v_variants, 0) = 0 and v_rms.base_units_per_package is not null and v_rms.package_confirmed_at is not null then
        v_factor := v_rms.base_units_per_package; v_factor_src := 'leverandor';
      elsif coalesce(v_variants, 0) = 0 and v_rms.id is null and v_stored_mat is not null then
        v_factor := v_stored_mat; v_factor_src := 'ravare';
      end if; -- flere varianter uten dokumentert linjepakning: ukjent (endres ikke)
    end if;
    v_last_factor := coalesce(v_factor, v_last_factor); v_last_src := coalesce(v_factor_src, v_last_src);

    select * into v_new from public.rm_line_base(v_line.quantity, v_line.unit, v_line.total_amount, v_rm.base_unit, v_factor);
    if v_new.base_quantity is null then v_n_unknown := v_n_unknown + 1; end if;
    if v_locked then v_n_locked := v_n_locked + 1; end if;

    if not v_locked and v_new.base_quantity is not null
       and (v_new.price_per_base_unit is distinct from v_line.old_ppb or v_new.base_quantity is distinct from v_line.old_bq) then
      v_n_changed := v_n_changed + 1;
      v_snapshot := v_snapshot || jsonb_build_object('line_id', v_line.id, 'base_quantity', v_line.old_bq, 'price_per_base_unit', v_line.old_ppb);
      if not p_dry_run then
        update invoice_lines set base_quantity = v_new.base_quantity, price_per_base_unit = v_new.price_per_base_unit where id = v_line.id;
      end if;
    end if;

    v_changes := v_changes || jsonb_build_object(
      'line_id', v_line.id, 'invoice_date', v_line.invoice_date, 'invoice_number', v_line.invoice_number, 'description', v_line.description,
      'quantity', v_line.quantity, 'unit', v_line.unit, 'total_amount', v_line.total_amount,
      'old_ppb', v_line.old_ppb, 'new_ppb', case when v_locked then v_line.old_ppb else v_new.price_per_base_unit end,
      'new_base_qty', v_new.base_quantity, 'method', v_new.method, 'factor', v_factor, 'factor_source', v_factor_src,
      'locked', v_locked);
  end loop;

  -- Avvik mot median vises bare som informasjon; det avgjør ikke kostprisen.
  select percentile_cont(0.5) within group (order by (c->>'new_ppb')::numeric) into v_median
    from jsonb_array_elements(v_changes) c where c->>'new_ppb' is not null;
  if v_median > 0 then
    select jsonb_agg(c || jsonb_build_object('avvik_pct', case when c->>'new_ppb' is null then null
             else round((((c->>'new_ppb')::numeric / v_median) - 1) * 100, 1) end, 'outlier', false)
           order by (c->>'invoice_date')::date, c->>'line_id') into v_changes from jsonb_array_elements(v_changes) c;
  end if;

  if p_dry_run then
    -- Forhåndsvisning: nyeste omregnede linje, ellers dagens velger.
    select (c->>'new_ppb')::numeric into v_cost_after from jsonb_array_elements(v_changes) c
     where c->>'new_ppb' is not null and (c->>'new_ppb')::numeric > 0
     order by (c->>'invoice_date')::date desc, c->>'line_id' desc limit 1;
    v_cost_after := coalesce(v_cost_after, (select x.price from public._rm_cost_candidates(p_raw_material_id, public.rm_oslo_today()) x limit 1), v_cost_before);
  else
    perform set_config('rm.defer_stats', '', true);
    v_cost_after := public.rm_apply_derived_cost_price(p_raw_material_id);
    insert into raw_material_cost_recalcs(raw_material_id, performed_by, reason, factor_used, factor_source, lines_changed, cost_before, cost_after, snapshot)
    values (p_raw_material_id, auth.uid(), p_reason, v_last_factor, v_last_src, v_n_changed, v_cost_before, v_cost_after, v_snapshot)
    returning id into v_recalc_id;
    if v_n_changed > 0 then perform public.refresh_purchase_stats(); end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'dry_run', p_dry_run, 'recalc_id', v_recalc_id, 'raw_material', v_rm.name, 'base_unit', v_rm.base_unit,
    'factor', v_last_factor, 'factor_source', v_last_src, 'lines_total', v_n_total, 'lines_changed', v_n_changed,
    'lines_unknown', v_n_unknown, 'lines_outlier', 0, 'lines_locked', v_n_locked, 'lines_excluded', v_n_excluded,
    'manual_cost_protected', false, 'ppb_median', round(v_median, 4),
    'cost_before', v_cost_before, 'cost_after', v_cost_after, 'changes', v_changes);
end;
$function$;