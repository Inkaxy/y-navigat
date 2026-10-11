-- 1) Eksplisitte felt
alter table public.raw_materials add column if not exists cost_source_history_id uuid;
alter table public.raw_materials add column if not exists cost_basis_status text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'raw_materials_cost_basis_status_chk') then
    alter table public.raw_materials add constraint raw_materials_cost_basis_status_chk
      check (cost_basis_status is null or cost_basis_status in ('verifisert','uverifisert','mangler'));
  end if;
end $$;
alter table public.raw_material_price_history add column if not exists cost_eligible boolean not null default false;

-- Bare rader skrevet av den atomiske RPC-en (revidert i audit_log) er eksplisitt kvalifisert.
update public.raw_material_price_history h set cost_eligible = true
 where h.cost_eligible = false and h.invoice_line_id is null
   and h.id in (select (a.changes->>'history_id')::uuid from public.audit_log a
                 where a.action = 'raw_material.cost_price_documented' and a.changes ? 'history_id');

-- Kjent kilde: siste avledning registrert i audit_log.
update public.raw_materials r set cost_source_history_id = x.hid
  from (select distinct on (a.entity_id) a.entity_id, (a.changes->>'history_id')::uuid hid
          from public.audit_log a
         where a.action = 'raw_material.cost_price_derived' and a.changes ? 'history_id'
         order by a.entity_id, a.occurred_at desc) x
 where r.id = x.entity_id and r.cost_source_history_id is null;

-- 2) Brukbar kostpris for kalkyler
create or replace function public.rm_usable_cost(p_raw_material_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case when r.cost_basis_status = 'mangler' then null else r.current_cost_price end
    from raw_materials r where r.id = p_raw_material_id
$$;
revoke all on function public.rm_usable_cost(uuid) from public, anon;
grant execute on function public.rm_usable_cost(uuid) to authenticated, service_role;

-- 3) Prisvelgeren
create or replace function public._rm_cost_candidates(p_raw_material_id uuid, p_as_of date)
 returns table(history_id uuid, price numeric, effective_date date, created_at timestamp with time zone, source text, supplier_id uuid, invoice_id uuid, invoice_line_id uuid, invoice_number text)
 language sql stable security definer set search_path to 'public'
as $function$
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
     -- Enhetsbytte (råvare): observasjoner datert eller registrert før byttet teller ikke.
     and not exists (select 1 from audit_log a
                      where a.entity_type = 'raw_material' and a.entity_id = rm.id and a.action = 'raw_material.base_unit_changed'
                        and (h.created_at < a.occurred_at or h.effective_date < (a.occurred_at at time zone 'Europe/Oslo')::date))
     -- Enhetsbytte på leverandørkoblingen.
     and not exists (select 1 from raw_material_suppliers rms
                      where rms.raw_material_id = rm.id and rms.supplier_id = h.supplier_id and rms.start_price_unit_change_at is not null
                        and (h.created_at < rms.start_price_unit_change_at
                             or h.effective_date < (rms.start_price_unit_change_at at time zone 'Europe/Oslo')::date))
     and (
       (h.source = 'invoice' and il.id is not null and i.id is not null
         and il.invoice_id = i.id and il.raw_material_id = h.raw_material_id
         and i.legal_entity_id = rm.legal_entity_id
         and h.supplier_id is not distinct from i.supplier_id
         and not coalesce(i.is_credit_note, false) and i.flagged_at is null
         and upper(coalesce(i.currency, 'NOK')) = 'NOK'
         and coalesce(i.status, '') <> 'cancelled'
         -- Observasjonen må stemme med linjen slik den står nå.
         and public.rm_is_finite(il.total_amount) and il.total_amount > 0
         and public.rm_is_finite(il.base_quantity) and il.base_quantity > 0
         and abs(h.price * il.base_quantity - il.total_amount) <= greatest(0.05, 0.01 * il.total_amount)
         and (
           exists (select 1 from invoice_line_cost_postings pp where pp.invoice_line_id = il.id and pp.revoked_at is null)
           or (coalesce(il.match_confidence::text, '') in ('manual','auto_high')
               and not coalesce(il.requires_review, false)
               and coalesce(btrim(il.review_reason), '') = ''
               and (i.status in ('ready','reconciled') or public.rm_invoice_lines_trusted(i))
               and (i.status = 'reconciled' or coalesce(i.lines_sum_status, '') <> 'mismatch')
               and not public.rm_invoice_has_read_issues(i.id))))
       or (h.source in ('manual','agreement','price_list') and h.invoice_line_id is null and h.cost_eligible)
     )
   order by h.effective_date desc, h.created_at desc, h.id desc
$function$;

-- 4) Avledning med eksplisitt kilde og status
create or replace function public.rm_apply_derived_cost_price(p_raw_material_id uuid)
 returns numeric language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_rm raw_materials%rowtype; c record; v_src text; v_at timestamptz; v_status text; v_revoked boolean;
begin
  select * into v_rm from raw_materials where id = p_raw_material_id for update;
  if not found then return null; end if;
  select * into c from public._rm_cost_candidates(p_raw_material_id, public.rm_oslo_today()) limit 1;
  if c.history_id is null then
    -- Kjent kilde som er ugyldiggjort (utgått/eldre/slettet) => mangler. Ukjent eldre pris => uverifisert. Prisen nulles aldri.
    v_revoked := v_rm.cost_source_history_id is not null and not exists (
      select 1 from raw_material_price_history h where h.id = v_rm.cost_source_history_id
         and h.superseded_at is null and not coalesce(h.is_legacy, false) and not coalesce(h.is_credit, false));
    v_status := case when v_rm.current_cost_price is null or v_revoked then 'mangler' else 'uverifisert' end;
    if v_rm.cost_basis_status is distinct from v_status then
      update raw_materials set cost_basis_status = v_status, updated_at = now() where id = p_raw_material_id;
      insert into audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
      values (auth.uid(), 'raw_material.cost_basis_status', 'raw_material', v_rm.id, v_rm.name, v_rm.legal_entity_id,
              jsonb_build_object('old', v_rm.cost_basis_status, 'new', v_status, 'price', v_rm.current_cost_price, 'source_history_id', v_rm.cost_source_history_id),
              case when v_status = 'mangler' then 'Kilden for kostprisen er ugyldiggjort' else 'Ingen verifisert kilde' end, 'ravarer');
    end if;
    return v_rm.current_cost_price;
  end if;
  -- Eldre manuell pris uten kvalifisert historikk vinner bare når den er nyere enn kandidaten (vises uverifisert).
  if coalesce(v_rm.price_source, '') = 'manual' and v_rm.price_updated_at is not null
     and c.effective_date < (v_rm.price_updated_at at time zone 'Europe/Oslo')::date
     and not exists (select 1 from raw_material_price_history h where h.raw_material_id = p_raw_material_id and h.cost_eligible) then
    if v_rm.cost_basis_status is distinct from 'uverifisert' then
      update raw_materials set cost_basis_status = 'uverifisert', updated_at = now() where id = p_raw_material_id;
    end if;
    return v_rm.current_cost_price;
  end if;
  v_src := case when c.source = 'invoice' then 'invoice' else 'manual' end;
  v_at := (c.effective_date::timestamp at time zone 'Europe/Oslo');
  if v_rm.current_cost_price is not distinct from c.price and v_rm.price_source is not distinct from v_src
     and v_rm.price_updated_at is not distinct from v_at and v_rm.cost_source_history_id is not distinct from c.history_id
     and v_rm.cost_basis_status is not distinct from 'verifisert' then
    return c.price;
  end if;
  update raw_materials set current_cost_price = c.price, price_updated_at = v_at, price_source = v_src,
         cost_source_history_id = c.history_id, cost_basis_status = 'verifisert', updated_at = now()
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

-- 5) Dokumentert manuell pris skriver eksplisitt kvalifisering
create or replace function public.rm_set_documented_cost_price(p_raw_material_id uuid, p_price numeric, p_effective_date date, p_reason text, p_supplier_id uuid default null::uuid, p_source text default 'manual'::text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
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
  insert into raw_material_price_history (raw_material_id, supplier_id, price, effective_date, source, notes, created_by, currency, is_credit, cost_eligible)
  values (p_raw_material_id, p_supplier_id, p_price, p_effective_date, p_source, btrim(p_reason), v_uid, 'NOK', false, true)
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

-- 6) Enhetsomregning uten tetthetsantakelse
create or replace function public.recipe_line_base_qty(p_quantity numeric, p_unit text, p_quantity_grams numeric, p_base_unit text, p_density_g_per_ml numeric)
 returns numeric language plpgsql immutable set search_path to 'public'
as $function$
declare
  u text := lower(btrim(coalesce(p_unit, ''))); b text := lower(btrim(coalesce(p_base_unit, 'kg')));
  d numeric := case when p_density_g_per_ml > 0 then p_density_g_per_ml end;
  v_f numeric; v_g numeric; v_ml numeric; v_vol boolean;
begin
  v_f := public.rm_unit_factor(p_unit, p_base_unit);
  if v_f is not null and p_quantity is not null then return p_quantity * v_f; end if;
  v_vol := u in ('ml','cl','dl','l','liter','ltr');
  v_ml := case when p_quantity is null then null when u = 'ml' then p_quantity when u = 'cl' then p_quantity * 10
               when u = 'dl' then p_quantity * 100 when u in ('l','liter','ltr') then p_quantity * 1000 end;
  -- Lagrede gram for en volumlinje kan være regnet med tetthet 1; de brukes ikke.
  v_g := case when v_vol then null when p_quantity_grams is not null then p_quantity_grams when p_quantity is null then null
              when u in ('g','gram') then p_quantity when u = 'kg' then p_quantity * 1000 when u = 'hg' then p_quantity * 100 end;
  if b in ('kg','g') then
    if v_g is null and v_ml is not null and d is not null then v_g := v_ml * d; end if;
    if v_g is null then return null; end if;
    return case b when 'kg' then v_g / 1000 else v_g end;
  elsif b in ('l','ml','dl','cl') then
    if v_ml is null and v_g is not null and d is not null then v_ml := v_g / d; end if;
    if v_ml is null then return null; end if;
    return case b when 'l' then v_ml / 1000 when 'dl' then v_ml / 100 when 'cl' then v_ml / 10 else v_ml end;
  end if;
  return null;
end $function$;

create or replace function public.recipe_line_base_qty(p_quantity numeric, p_unit text, p_quantity_grams numeric, p_base_unit text)
 returns numeric language sql immutable set search_path to 'public'
as $function$ select public.recipe_line_base_qty(p_quantity, p_unit, p_quantity_grams, p_base_unit, null::numeric) $function$;

-- 7) Kalkylen leser brukbar kostpris, tetthet og status
do $$
declare d text; o text;
begin
  d := pg_get_functiondef('public.product_cost(uuid,integer)'::regprocedure); o := d;
  d := replace(d, 'select current_cost_price into v_base from public.raw_materials where id = v_add.raw_material_id;',
                  'select public.rm_usable_cost(v_add.raw_material_id) into v_base;');
  d := replace(d, 'select rm.current_cost_price * rmp.base_units_per_sold_unit, rm.current_cost_price',
                  'select public.rm_usable_cost(rm.id) * rmp.base_units_per_sold_unit, public.rm_usable_cost(rm.id)');
  d := replace(d, 'rm.current_cost_price, rm.name as rm_name, rm.base_unit, rm.package_confirmed_at',
                  'public.rm_usable_cost(rm.id) as current_cost_price, rm.cost_basis_status, rm.density_g_per_ml, rm.name as rm_name, rm.base_unit, rm.package_confirmed_at');
  d := replace(d, 'public.recipe_line_base_qty(v_line.quantity, v_line.unit, v_line.quantity_grams, v_line.base_unit)',
                  'public.recipe_line_base_qty(v_line.quantity, v_line.unit, v_line.quantity_grams, v_line.base_unit, v_line.density_g_per_ml)');
  d := replace(d, 'v_raw := v_raw + v_qty * v_line.current_cost_price;',
                  'v_raw := v_raw + v_qty * v_line.current_cost_price;
            if v_line.cost_basis_status = ''uverifisert'' then
              if v_quality = ''A'' then v_quality := ''B''; end if;
              v_notes := array_append(v_notes, format(''%s: kostprisen har ingen verifisert kilde'', v_line.rm_name));
            end if;');
  d := replace(d, 'coalesce(pl.unit_price_override, rm.current_cost_price, 0)', 'coalesce(pl.unit_price_override, public.rm_usable_cost(rm.id), 0)');
  if position('rm.current_cost_price' in d) > 0 or position('select current_cost_price into' in d) > 0
     or position('v_line.density_g_per_ml' in d) = 0 or position('ingen verifisert kilde' in d) = 0 then
    raise exception 'product_cost: forventet tekst ble ikke funnet; avbryter';
  end if;
  execute d;
end $$;

-- 8) Reberegning: bare bekreftet linjepakning eller varenummer-koblet bekreftet variant kan endre historiske linjer
do $$
declare d text;
begin
  d := pg_get_functiondef('public.recalc_raw_material_cost(uuid,boolean,text,numeric,uuid,numeric)'::regprocedure);
  d := replace(d, 'v_last_factor numeric; v_last_src text; v_rms record; v_variants int; v_variant numeric; v_locked boolean;',
                  'v_last_factor numeric; v_last_src text; v_rms record; v_variants int; v_variant numeric; v_locked boolean; v_apply boolean; v_n_preview int := 0; v_sku_var numeric;');
  d := replace(d, 'select il.id, il.quantity, il.unit, il.total_amount, il.description, il.package_size, il.package_unit, il.count_per_package,',
                  'select il.id, il.quantity, il.unit, il.total_amount, il.description, il.package_size, il.package_unit, il.count_per_package, il.package_source_rms_id, il.supplier_sku, il.match_confidence::text as conf,');
  d := replace(d, '      if v_factor is not null then v_factor_src := ''linje''; end if;',
                  '      if v_factor is not null then v_factor_src := case when v_line.package_source_rms_id is not null or v_line.conf = ''manual'' then ''linje_bekreftet'' else ''linje_ulest'' end; end if;');
  d := replace(d, '    v_last_factor := coalesce(v_factor, v_last_factor);',
                  '    -- Varenummer-koblet bekreftet variant er historisk sporbar; dagens eneste pakning er det ikke.
    if v_factor_src is distinct from ''linje_bekreftet'' and v_line.supplier_sku is not null then
      select v.base_units_per_package into v_sku_var from raw_material_supplier_packages v
        join raw_material_suppliers r2 on r2.id = v.raw_material_supplier_id
       where r2.raw_material_id = p_raw_material_id and r2.supplier_id = v_line.supplier_id and v.confirmed_at is not null
         and v.base_units_per_package is not null and v.supplier_sku_norm = public.rm_sku_norm(v_line.supplier_sku)
         and (v_line.package_size is null or (v.package_size = v_line.package_size and v.package_unit is not distinct from v_line.package_unit))
       limit 1;
      if v_sku_var is not null and (select count(*) from raw_material_supplier_packages v join raw_material_suppliers r2 on r2.id = v.raw_material_supplier_id
            where r2.raw_material_id = p_raw_material_id and r2.supplier_id = v_line.supplier_id and v.confirmed_at is not null
              and v.supplier_sku_norm = public.rm_sku_norm(v_line.supplier_sku)) = 1 then
        v_factor := v_sku_var; v_factor_src := ''variant_varenr'';
      end if;
      v_sku_var := null;
    end if;
    v_apply := v_factor_src in (''linje_bekreftet'', ''variant_varenr'');
    v_last_factor := coalesce(v_factor, v_last_factor);');
  d := replace(d, '    if not v_locked and v_new.base_quantity is not null
       and (v_new.price_per_base_unit is distinct from v_line.old_ppb or v_new.base_quantity is distinct from v_line.old_bq) then',
                  '    if not v_locked and not v_apply and v_new.base_quantity is not null
       and (v_new.price_per_base_unit is distinct from v_line.old_ppb or v_new.base_quantity is distinct from v_line.old_bq) then
      v_n_preview := v_n_preview + 1;
    end if;
    if not v_locked and v_apply and v_new.base_quantity is not null
       and (v_new.price_per_base_unit is distinct from v_line.old_ppb or v_new.base_quantity is distinct from v_line.old_bq) then');
  d := replace(d, '''new_ppb'', case when v_locked then v_line.old_ppb else v_new.price_per_base_unit end,',
                  '''new_ppb'', case when v_locked then v_line.old_ppb else v_new.price_per_base_unit end, ''applies'', v_apply and not v_locked,
      ''preview_reason'', case when v_locked or v_apply then null else ''Pakningen er ikke bekreftet for denne linjen (bare forhåndsvisning)'' end,');
  d := replace(d, '''lines_locked'', v_n_locked,', '''lines_locked'', v_n_locked, ''lines_preview_only'', v_n_preview,');
  -- Forhåndsvisningens nye kostpris bygger bare på linjer som faktisk kan endres.
  d := replace(d, '     where c->>''new_ppb'' is not null and (c->>''new_ppb'')::numeric > 0
     order by',  '     where c->>''new_ppb'' is not null and (c->>''new_ppb'')::numeric > 0 and coalesce((c->>''applies'')::boolean, false)
     order by');
  if position('v_n_preview' in d) = 0 or position('variant_varenr' in d) = 0 or position('linje_bekreftet' in d) = 0
     or position('lines_preview_only' in d) = 0 or position('if not v_locked and v_apply' in d) = 0 or position('''applies'')::boolean' in d) = 0 then
    raise exception 'recalc_raw_material_cost: forventet tekst ble ikke funnet; avbryter';
  end if;
  execute d;
end $$;

-- 9) Atomisk oppdatering ved ugyldiggjøring/endring
create or replace function public.trg_rmph_reapply_cost()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op = 'DELETE' then
    perform public.rm_apply_derived_cost_price(old.raw_material_id);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.superseded_at is not distinct from new.superseded_at and old.is_legacy is not distinct from new.is_legacy
     and old.price is not distinct from new.price and old.effective_date is not distinct from new.effective_date
     and old.cost_eligible is not distinct from new.cost_eligible and old.is_credit is not distinct from new.is_credit then
    return new;
  end if;
  perform public.rm_apply_derived_cost_price(new.raw_material_id);
  return new;
end $function$;
drop trigger if exists trg_rmph_reapply_cost on public.raw_material_price_history;
create trigger trg_rmph_reapply_cost after update or delete on public.raw_material_price_history
  for each row execute function public.trg_rmph_reapply_cost();

do $$
declare d text;
begin
  d := pg_get_functiondef('public.fn_invoice_line_match_price_history()'::regprocedure);
  d := replace(d, '     and old.requires_review is not distinct from new.requires_review then',
                  '     and old.requires_review is not distinct from new.requires_review
     and old.total_amount is not distinct from new.total_amount
     and old.review_reason is not distinct from new.review_reason then');
  if position('old.total_amount is not distinct from new.total_amount' in d) = 0 then raise exception 'fn_invoice_line_match_price_history: ikke funnet'; end if;
  execute d;
end $$;

-- Kalkylebuffer markeres utdatert også når grunnlagsstatus endres
create or replace function public.trg_raw_materials_h4_cost()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_ids uuid[];
begin
  select array_agg(n.id) into v_ids
    from new_rows n join old_rows o on o.id = n.id
   where n.current_cost_price   is distinct from o.current_cost_price
      or n.base_unit            is distinct from o.base_unit
      or n.unit_weight_grams    is distinct from o.unit_weight_grams
      or n.package_confirmed_at is distinct from o.package_confirmed_at
      or n.cost_basis_status    is distinct from o.cost_basis_status
      or n.density_g_per_ml     is distinct from o.density_g_per_ml;
  if v_ids is not null then
    perform public.h4_mark_cost_stale(public.h4_products_for_raw_materials(v_ids));
  end if;
  return null;
end;
$function$;

revoke all on function public._rm_cost_candidates(uuid, date) from public, anon, authenticated;
revoke all on function public.rm_apply_derived_cost_price(uuid) from public, anon, authenticated;
revoke all on function public.trg_rmph_reapply_cost() from public, anon, authenticated;
