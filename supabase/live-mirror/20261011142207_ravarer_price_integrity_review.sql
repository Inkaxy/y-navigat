-- REVIEWED LOCAL PACKAGE ONLY; root applies after independent review.
-- No invoice lines or posted snapshots are modified.
BEGIN;
CREATE TABLE IF NOT EXISTS public.raw_material_price_review_holds (
 history_id uuid PRIMARY KEY REFERENCES public.raw_material_price_history(id) ON DELETE CASCADE,
 reason text NOT NULL, held_at timestamptz NOT NULL DEFAULT now(),
 released_at timestamptz, released_by uuid, release_reason text,
 CHECK (released_at IS NULL OR (released_by IS NOT NULL AND nullif(btrim(release_reason),'') IS NOT NULL))
);
ALTER TABLE public.raw_material_price_review_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.raw_material_price_review_holds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.raw_material_price_review_holds TO service_role;

CREATE OR REPLACE FUNCTION public.rm_price_line_validation_reason(p_line_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $f$
DECLARE l invoice_lines%rowtype; i invoices%rowtype; rm raw_materials%rowtype; s raw_material_suppliers%rowtype;
 f numeric; observed numeric;
BEGIN
 SELECT * INTO l FROM invoice_lines WHERE id=p_line_id;
 IF NOT FOUND THEN RETURN 'missing_line'; END IF;
 SELECT * INTO i FROM invoices WHERE id=l.invoice_id;
 SELECT * INTO rm FROM raw_materials WHERE id=l.raw_material_id;
 IF rm.id IS NULL OR i.id IS NULL THEN RETURN 'missing_link'; END IF;
 -- Posting records contain no independently verified line snapshot. Posting alone
 -- therefore does not waive invoice checks or dimensional validation.
 IF coalesce(i.lines_sum_status,'') <> 'ok' THEN RETURN 'invoice_sum_not_verified'; END IF;
 IF coalesce(l.requires_review,false) OR nullif(btrim(l.review_reason),'') IS NOT NULL
    THEN RETURN 'line_needs_review'; END IF;
 IF NOT rm_is_finite(l.quantity) OR l.quantity<=0 OR NOT rm_is_finite(l.base_quantity) OR l.base_quantity<=0
    THEN RETURN 'invalid_quantity'; END IF;
 f:=rm_unit_factor(l.unit,rm.base_unit);
 IF f IS NULL THEN
   SELECT * INTO s FROM raw_material_suppliers WHERE id=l.package_source_rms_id
     AND raw_material_id=rm.id AND supplier_id=i.supplier_id;
   IF s.id IS NULL OR s.package_confirmed_at IS NULL OR NOT rm_is_finite(s.base_units_per_package)
      OR s.base_units_per_package<=0 THEN RETURN 'package_not_confirmed'; END IF;
   -- A current supplier factor alone cannot rewrite an old observation.
   IF lower(btrim(rm.base_unit))='stk' THEN
      observed:=case when l.count_per_package>0 then l.count_per_package
        when rm_unit_factor(l.package_unit,'stk') IS NOT NULL then l.package_size*rm_unit_factor(l.package_unit,'stk') else null end;
   ELSE
      observed:=l.package_size*rm_unit_factor(l.package_unit,rm.base_unit)*coalesce(nullif(l.count_per_package,0),1);
   END IF;
   IF NOT rm_is_finite(observed) OR observed<=0 THEN RETURN 'package_snapshot_missing'; END IF;
   IF abs(observed-s.base_units_per_package)>greatest(0.000001,0.0005*observed)
      THEN RETURN 'package_snapshot_conflicts'; END IF;
   f:=observed;
 END IF;
 IF abs(l.base_quantity-l.quantity*f)>greatest(0.000001,0.0005*l.quantity*f)
   THEN RETURN 'base_quantity_conflicts'; END IF;
 RETURN NULL;
END $f$;
REVOKE ALL ON FUNCTION public.rm_price_line_validation_reason(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rm_price_line_validation_reason(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public._rm_cost_candidates(p_raw_material_id uuid, p_as_of date)
 RETURNS TABLE(history_id uuid, price numeric, effective_date date, created_at timestamp with time zone, source text, supplier_id uuid, invoice_id uuid, invoice_line_id uuid, invoice_number text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select h.id, h.price, h.effective_date, h.created_at, h.source, h.supplier_id, h.invoice_id, h.invoice_line_id, i.invoice_number::text
    from raw_material_price_history h
    join raw_materials rm on rm.id = h.raw_material_id
    left join invoices i on i.id = h.invoice_id
    left join invoice_lines il on il.id = h.invoice_line_id
    left join suppliers s on s.id = h.supplier_id
   where h.raw_material_id = p_raw_material_id
     and h.effective_date is not null and h.effective_date <= p_as_of
     and not exists(select 1 from raw_material_price_review_holds q where q.history_id=h.id and q.released_at is null)
     and (h.source <> 'invoice' or rm_price_line_validation_reason(h.invoice_line_id) is null)
     and (rm_unit_change_at(rm.id) is null or (h.created_at>=rm_unit_change_at(rm.id)
       and h.effective_date >= (rm_unit_change_at(rm.id) at time zone 'Europe/Oslo')::date))
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
$function$
;
CREATE OR REPLACE FUNCTION public.rm_apply_derived_cost_price(p_raw_material_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rm raw_materials%rowtype; c record; v_src text; v_at timestamptz; v_status text; v_revoked boolean;
begin
  select * into v_rm from raw_materials where id = p_raw_material_id for update;
  if not found then return null; end if;
  select * into c from public._rm_cost_candidates(p_raw_material_id, public.rm_oslo_today()) limit 1;
  if c.history_id is null then
    -- Kjent kilde som er ugyldiggjort (utgått/eldre/slettet) => mangler. Ukjent eldre pris => uverifisert. Prisen nulles aldri.
    -- Ugyldiggjort = utgått/eldre/kreditert/slettet, eller fakturalinjen stemmer ikke lenger (sum, kobling, leverandør).
    v_revoked := v_rm.cost_source_history_id is not null;
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
$function$
;
CREATE OR REPLACE FUNCTION public.recalc_raw_material_cost(p_raw_material_id uuid, p_dry_run boolean DEFAULT true, p_reason text DEFAULT NULL::text, p_override_material_factor numeric DEFAULT NULL::numeric, p_override_supplier_id uuid DEFAULT NULL::uuid, p_override_supplier_factor numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rm record; v_stored_mat numeric; v_factor numeric; v_factor_src text;
  v_changes jsonb := '[]'::jsonb; v_snapshot jsonb := '[]'::jsonb; v_line record; v_new record;
  v_n_total int := 0; v_n_changed int := 0; v_n_unknown int := 0; v_n_locked int := 0; v_n_excluded int := 0;
  v_cost_before numeric; v_cost_after numeric; v_median numeric; v_recalc_id uuid;
  v_last_factor numeric; v_last_src text; v_rms record; v_variants int; v_variant numeric; v_locked boolean; v_apply boolean; v_n_preview int := 0; v_sku_var numeric;
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
    select il.id, il.quantity, il.unit, il.total_amount, il.description, il.package_size, il.package_unit, il.count_per_package, il.package_source_rms_id, il.supplier_sku, il.match_confidence::text as conf,
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
      if v_factor is not null then v_factor_src := case when exists(select 1 from raw_material_suppliers s where s.id=v_line.package_source_rms_id and s.raw_material_id=p_raw_material_id and s.supplier_id=v_line.supplier_id and s.package_confirmed_at is not null and rm_is_finite(s.base_units_per_package) and abs(s.base_units_per_package-v_factor)<=0.0005*greatest(1,v_factor)) then 'linje_bekreftet' else 'linje_ulest' end; end if;
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
    -- Varenummer-koblet bekreftet variant er historisk sporbar; dagens eneste pakning er det ikke.
    if v_factor_src is distinct from 'linje_bekreftet' and v_line.supplier_sku is not null then
      select v.base_units_per_package into v_sku_var from raw_material_supplier_packages v
        join raw_material_suppliers r2 on r2.id = v.raw_material_supplier_id
       where r2.raw_material_id = p_raw_material_id and r2.supplier_id = v_line.supplier_id and v.confirmed_at is not null
         and v.base_units_per_package is not null and v.supplier_sku_norm = public.rm_sku_norm(v_line.supplier_sku)
         and (v_line.package_size is null or (v.package_size = v_line.package_size and v.package_unit is not distinct from v_line.package_unit))
       limit 1;
      if v_sku_var is not null and (select count(*) from raw_material_supplier_packages v join raw_material_suppliers r2 on r2.id = v.raw_material_supplier_id
            where r2.raw_material_id = p_raw_material_id and r2.supplier_id = v_line.supplier_id and v.confirmed_at is not null
              and v.supplier_sku_norm = public.rm_sku_norm(v_line.supplier_sku)) = 1 then
        v_factor := v_sku_var; v_factor_src := 'variant_varenr';
      end if;
      v_sku_var := null;
    end if;
    v_apply := v_factor_src in ('linje_bekreftet', 'variant_varenr');
    v_last_factor := coalesce(v_factor, v_last_factor); v_last_src := coalesce(v_factor_src, v_last_src);

    select * into v_new from public.rm_line_base(v_line.quantity, v_line.unit, v_line.total_amount, v_rm.base_unit, v_factor);
    if v_new.base_quantity is null then v_n_unknown := v_n_unknown + 1; end if;
    if v_locked then v_n_locked := v_n_locked + 1; end if;

    if not v_locked and not v_apply and v_new.base_quantity is not null
       and (v_new.price_per_base_unit is distinct from v_line.old_ppb or v_new.base_quantity is distinct from v_line.old_bq) then
      v_n_preview := v_n_preview + 1;
    end if;
    if not v_locked and v_apply and v_new.base_quantity is not null
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
      'old_ppb', v_line.old_ppb, 'new_ppb', case when v_locked then v_line.old_ppb else v_new.price_per_base_unit end, 'applies', v_apply and not v_locked,
      'preview_reason', case when v_locked or v_apply then null else 'Pakningen er ikke bekreftet for denne linjen (bare forhåndsvisning)' end,
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
     where c->>'new_ppb' is not null and (c->>'new_ppb')::numeric > 0 and coalesce((c->>'applies')::boolean, false)
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
    'lines_unknown', v_n_unknown, 'lines_outlier', 0, 'lines_locked', v_n_locked, 'lines_preview_only', v_n_preview, 'lines_excluded', v_n_excluded,
    'manual_cost_protected', false, 'ppb_median', round(v_median, 4),
    'cost_before', v_cost_before, 'cost_after', v_cost_after, 'changes', v_changes);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_rmph_reapply_cost()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    perform public.rm_apply_derived_cost_price(old.raw_material_id);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.superseded_at is not distinct from new.superseded_at and old.is_legacy is not distinct from new.is_legacy
     and old.price is not distinct from new.price and old.effective_date is not distinct from new.effective_date
     and old.cost_eligible is not distinct from new.cost_eligible and old.is_credit is not distinct from new.is_credit
     and old.currency is not distinct from new.currency and old.supplier_id is not distinct from new.supplier_id
     and old.invoice_id is not distinct from new.invoice_id and old.created_at is not distinct from new.created_at
     and old.raw_material_id is not distinct from new.raw_material_id and old.invoice_line_id is not distinct from new.invoice_line_id then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.raw_material_id is distinct from new.raw_material_id then
    perform public.rm_apply_derived_cost_price(old.raw_material_id);
  end if;
  perform public.rm_apply_derived_cost_price(new.raw_material_id);
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.rm_usable_cost(p_raw_material_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $f$
 SELECT CASE WHEN cost_basis_status='verifisert' THEN current_cost_price ELSE NULL END FROM raw_materials WHERE id=p_raw_material_id
$f$;

-- The twelve explicitly held prices from the reviewed refresh are blocked persistently.
INSERT INTO raw_material_price_review_holds(history_id,reason)
SELECT id,'2026-10-11 refresh review: large change requires source-document confirmation' FROM raw_material_price_history WHERE id IN ('8657a256-e901-48c8-a14e-7424fbe514b5'::uuid,'bf582955-c9b4-4a28-bcc2-2492cd764463'::uuid,'7bd31916-bb61-4427-9718-367dd8be1bc3'::uuid,'9c4e9535-f9f1-4c4e-ad84-db9f7bf58aa8'::uuid,'7e254909-9ee8-405e-a790-5c8e781e9558'::uuid,'f4cf789c-ad8d-40df-8f94-1d30639eda3d'::uuid,'4c5929f6-625a-41f1-9e9c-164292135c03'::uuid,'89ff3e13-29b7-4178-b935-3d254d07f421'::uuid,'ebbc930d-23e6-4086-9219-4e918c826501'::uuid,'de3ca4dc-56f9-4fb7-a5d5-94717c90a6fe'::uuid,'8b879bee-71ee-48b1-af21-4147ab298f9b'::uuid,'c1abab3e-9674-499f-8e11-1bcaf2185cbb'::uuid)
ON CONFLICT(history_id) DO NOTHING;

-- Only the 52 sources actually changed in that refresh receive a targeted integrity hold.
INSERT INTO raw_material_price_review_holds(history_id,reason)
SELECT h.id,'2026-10-11 source recovery: '||rm_price_line_validation_reason(h.invoice_line_id)
FROM audit_log a JOIN raw_material_price_history h ON h.id=(a.changes->>'history_id')::uuid
WHERE a.action='raw_material.cost_price_derived'
 AND a.occurred_at>='2026-10-11 14:03Z' AND a.occurred_at<'2026-10-11 14:04Z'
 AND rm_price_line_validation_reason(h.invoice_line_id) IS NOT NULL
ON CONFLICT(history_id) DO NOTHING;

-- Holds affect only selected derived prices. Original values remain in audit and raw rows.
CREATE OR REPLACE FUNCTION public.trg_rm_price_hold_reapply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $f$
DECLARE r uuid;
BEGIN
 SELECT raw_material_id INTO r FROM raw_material_price_history WHERE id=coalesce(new.history_id,old.history_id);
 IF r IS NOT NULL THEN PERFORM rm_apply_derived_cost_price(r); END IF;
 RETURN coalesce(new,old);
END $f$;
DROP TRIGGER IF EXISTS trg_rm_price_hold_reapply ON raw_material_price_review_holds;
CREATE TRIGGER trg_rm_price_hold_reapply AFTER INSERT OR UPDATE OR DELETE ON raw_material_price_review_holds
FOR EACH ROW EXECUTE FUNCTION trg_rm_price_hold_reapply();

-- Refresh derived status/cost for all known sources and legacy status, no invoice/history edits.

-- Invalidate derived price when any eligibility input changes, including package proofs.
CREATE OR REPLACE FUNCTION public.trg_rm_price_line_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $f$
BEGIN
 IF TG_OP<>'INSERT' AND old.raw_material_id IS NOT NULL THEN PERFORM rm_apply_derived_cost_price(old.raw_material_id); END IF;
 IF TG_OP<>'DELETE' AND new.raw_material_id IS NOT NULL THEN PERFORM rm_apply_derived_cost_price(new.raw_material_id); END IF;
 RETURN coalesce(new,old);
END $f$;
DROP TRIGGER IF EXISTS trg_rm_price_line_integrity ON invoice_lines;
CREATE TRIGGER trg_rm_price_line_integrity AFTER UPDATE OF quantity,unit,base_quantity,total_amount,package_size,package_unit,count_per_package,package_source_rms_id,raw_material_id,invoice_id,requires_review,review_reason,match_confidence OR DELETE
ON invoice_lines FOR EACH ROW EXECUTE FUNCTION trg_rm_price_line_integrity();

CREATE OR REPLACE FUNCTION public.trg_rm_price_invoice_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $f$
DECLARE r uuid;
BEGIN
 FOR r IN SELECT DISTINCT raw_material_id FROM raw_material_price_history WHERE invoice_id=coalesce(new.id,old.id) LOOP
   PERFORM rm_apply_derived_cost_price(r);
 END LOOP;
 RETURN coalesce(new,old);
END $f$;
DROP TRIGGER IF EXISTS trg_rm_price_invoice_integrity ON invoices;
CREATE TRIGGER trg_rm_price_invoice_integrity AFTER UPDATE OF status,lines_sum_status,flagged_at,is_credit_note,currency,supplier_id,legal_entity_id
ON invoices FOR EACH ROW EXECUTE FUNCTION trg_rm_price_invoice_integrity();

CREATE OR REPLACE FUNCTION public.trg_rm_price_package_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $f$
BEGIN
 IF TG_OP<>'INSERT' THEN PERFORM rm_apply_derived_cost_price(old.raw_material_id); END IF;
 IF TG_OP<>'DELETE' THEN PERFORM rm_apply_derived_cost_price(new.raw_material_id); END IF;
 RETURN coalesce(new,old);
END $f$;
DROP TRIGGER IF EXISTS trg_rm_price_package_integrity ON raw_material_suppliers;
CREATE TRIGGER trg_rm_price_package_integrity AFTER UPDATE OF package_confirmed_at,base_units_per_package,raw_material_id,supplier_id,start_price_unit_change_at OR DELETE
ON raw_material_suppliers FOR EACH ROW EXECUTE FUNCTION trg_rm_price_package_integrity();
DROP TRIGGER IF EXISTS trg_rm_price_unit_integrity ON raw_material_changelog;
CREATE TRIGGER trg_rm_price_unit_integrity AFTER INSERT OR UPDATE OR DELETE ON raw_material_changelog
FOR EACH ROW EXECUTE FUNCTION trg_rm_price_package_integrity();

DO $f$ DECLARE r uuid; BEGIN
 FOR r IN SELECT id FROM raw_materials LOOP PERFORM rm_apply_derived_cost_price(r); END LOOP;
END $f$;
COMMIT;



