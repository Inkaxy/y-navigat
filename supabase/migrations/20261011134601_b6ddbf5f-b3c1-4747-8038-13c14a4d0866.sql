CREATE OR REPLACE FUNCTION public.rm_extraction_example_is_safe(p_id uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
 e invoice_extraction_examples%rowtype; c invoice_line_corrections%rowtype;
 v invoices%rowtype; j jsonb; k text; n numeric; issues jsonb;
begin
 select * into e from invoice_extraction_examples where id=p_id;
 if not found then return false; end if;
 select * into c from invoice_line_corrections where id=e.source_correction_id;
 if not found then return false; end if;
 select * into v from invoices where id=c.invoice_id;
 if not found then return false; end if;
 if e.legal_entity_id is distinct from c.legal_entity_id
 or e.legal_entity_id is distinct from v.legal_entity_id
 or e.supplier_id is null
 or e.supplier_id is distinct from c.supplier_id
 or e.supplier_id is distinct from v.supplier_id
 or e.corrected is distinct from c.corrected
 or not exists(select 1 from invoice_lines l where l.id=c.invoice_line_id and l.invoice_id=v.id)
 or not exists(select 1 from suppliers s where s.id=e.supplier_id and s.legal_entity_id=e.legal_entity_id)
 then return false; end if;
 if coalesce(e.accepted_issues,'[]'::jsonb) <> '[]'::jsonb
 or coalesce(c.accepted_issues,'[]'::jsonb) <> '[]'::jsonb then return false; end if;
 j:=e.corrected;
 if jsonb_typeof(j) is distinct from 'object' then return false; end if;
 foreach k in array array['quantity','package_size','count_per_package','unit_price','total_amount','discount_amount'] loop
   if j ? k and j->k <> 'null'::jsonb then
     if jsonb_typeof(j->k) <> 'number' then return false; end if;
     n:=(j->>k)::numeric;
     if not rm_is_finite(n) then return false; end if;
     if k in ('package_size','count_per_package') and n<=0 then return false; end if;
     if k='discount_amount' and n<0 then return false; end if;
   end if;
 end loop;
 if j->>'unit_price_basis' is not null and not (j->>'unit_price_basis'=any(array['mengdeenhet','pakning','stk','kg','g','l','ml'])) then return false; end if;
 if j->>'line_kind' is not null and not (j->>'line_kind'=any(array['vare','pant','frakt','gebyr','rabatt','avrunding','mva','annet'])) then return false; end if;
 issues:=rm_line_read_issues_v2((j->>'quantity')::numeric,j->>'unit',(j->>'unit_price')::numeric,(j->>'total_amount')::numeric,
   (j->>'package_size')::numeric,j->>'package_unit',(j->>'count_per_package')::numeric,coalesce(v.is_credit_note,false),
   j->>'unit_price_basis',(j->>'discount_amount')::numeric,j->>'line_kind');
 return issues='[]'::jsonb;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $function$;
REVOKE ALL ON FUNCTION public.rm_extraction_example_is_safe(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rm_set_extraction_example_active(p_example_id uuid, p_active boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); e invoice_extraction_examples%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into e from invoice_extraction_examples where id = p_example_id for update;
  if not found then raise exception 'finnes_ikke' using errcode = 'P0002'; end if;
  if not has_ravarer_invoice_access(e.legal_entity_id, 'write') then raise exception 'forbidden: Mangler skrivetilgang til fakturaer' using errcode = '42501'; end if;
  if p_active is null then raise exception 'ugyldig_aktiv'; end if;
  if p_active then
    if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'begrunnelse: Bekreft kontroll mot originalen med en begrunnelse.' using errcode = '22023'; end if;
    if not public.rm_extraction_example_is_safe(e.id) then
      raise exception 'uavklart_eksempel: Rett uavklarte tall eller prisgrunnlag i fakturalinjen og lagre et nytt læringseksempel.' using errcode = '22023';
    end if;
  end if;
  update invoice_extraction_examples set is_active = p_active,
    deactivated_at = case when p_active then null else now() end,
    deactivated_by = case when p_active then null else v_uid end
  where id = e.id;
  insert into audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, case when p_active then 'extraction_example.activated' else 'extraction_example.deactivated' end,
          'supplier', e.supplier_id, e.legal_entity_id, jsonb_build_object('example_id', e.id), nullif(btrim(coalesce(p_reason,'')), ''), 'ravarer');
  return jsonb_build_object('ok', true, 'is_active', p_active);
end $function$;

CREATE OR REPLACE FUNCTION public.rm_correct_invoice_line(p_line_id uuid, p_expected_updated_at timestamp with time zone, p_changes jsonb, p_reason text, p_learn boolean DEFAULT false, p_accept_issues boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_inv_id uuid; v invoices%rowtype; l invoice_lines%rowtype;
  v_allowed text[] := array['supplier_sku','description','quantity','unit','package_size','package_unit','count_per_package','unit_price','total_amount','line_kind','unit_price_basis','discount_amount'];
  v_numeric text[] := array['quantity','package_size','count_per_package','unit_price','total_amount','discount_amount'];
  v_kinds text[] := array['vare','pant','frakt','gebyr','rabatt','avrunding','mva','annet'];
  v_bases text[] := array['mengdeenhet','pakning','stk','kg','g','l','ml'];
  k text; v_num numeric; v_orig jsonb; v_new jsonb; v_changed text[] := '{}'; v_identity boolean;
  v_issues jsonb; v_accepted jsonb := '[]'::jsonb; v_sum jsonb; v_corr uuid; v_ex uuid := null; v_upd timestamptz;
  v_ex_active boolean := true;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select invoice_id into v_inv_id from invoice_lines where id = p_line_id;
  if v_inv_id is null then raise exception 'finnes_ikke: Fakturalinjen finnes ikke' using errcode = 'P0002'; end if;
  select * into v from invoices where id = v_inv_id for update;
  if not has_ravarer_invoice_access(v.legal_entity_id, 'write') then
    raise exception 'forbidden: Mangler skrivetilgang til fakturaer' using errcode = '42501';
  end if;
  select * into l from invoice_lines where id = p_line_id for update;
  if l.updated_at is distinct from p_expected_updated_at then
    raise exception 'versjon_endret: Linjen er endret siden du åpnet den. Last inn på nytt.' using errcode = '40001';
  end if;
  if v.status not in ('imported','needs_review','ready') or v.flagged_at is not null then
    raise exception 'faktura_last: Fakturaen er avstemt, flagget eller lukket. Linjene kan ikke rettes.' using errcode = '55000';
  end if;
  if exists (select 1 from invoice_internal_approvals a where a.invoice_id = v.id and a.status = 'approved') then
    raise exception 'faktura_godkjent: Fakturaen er internt godkjent. Trekk tilbake godkjenningen før du retter linjer.' using errcode = '55000';
  end if;
  if exists (select 1 from invoice_line_cost_postings p where p.invoice_line_id = l.id and p.revoked_at is null) then
    raise exception 'kostpris_fort: Kostpris er ført for linjen. Den kan ikke rettes.' using errcode = '55000';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then
    raise exception 'begrunnelse: Skriv en begrunnelse for rettelsen.' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'ugyldig: Endringene må være et objekt.' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_changes) loop
    if not k = any(v_allowed) then raise exception 'ukjent_felt: %', k using errcode = '22023'; end if;
    if k = any(v_numeric) and jsonb_typeof(p_changes->k) <> 'null' then
      if jsonb_typeof(p_changes->k) <> 'number' then raise exception 'ugyldig_tall: % må være et tall', k using errcode = '22023'; end if;
      v_num := (p_changes->>k)::numeric;
      if not rm_is_finite(v_num) then raise exception 'ugyldig_tall: % må være et endelig tall', k using errcode = '22023'; end if;
      if k in ('package_size','count_per_package') and v_num <= 0 then raise exception 'ugyldig_tall: % må være større enn 0', k using errcode = '22023'; end if;
      if k = 'discount_amount' and v_num < 0 then raise exception 'ugyldig_tall: rabatt oppgis som positivt kronebeløp' using errcode = '22023'; end if;
    end if;
    if k = 'line_kind' and jsonb_typeof(p_changes->k) <> 'null' and not (p_changes->>k) = any(v_kinds) then
      raise exception 'ugyldig_linjetype' using errcode = '22023';
    end if;
    if k = 'unit_price_basis' and jsonb_typeof(p_changes->k) <> 'null' and not (p_changes->>k) = any(v_bases) then
      raise exception 'ugyldig_prisgrunnlag' using errcode = '22023';
    end if;
    if k in ('supplier_sku','description','unit','package_unit') and jsonb_typeof(p_changes->k) not in ('string','null') then
      raise exception 'ugyldig: % må være tekst', k using errcode = '22023';
    end if;
  end loop;

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_orig from jsonb_each(to_jsonb(l)) e where e.key = any(v_allowed);
  v_new := v_orig || p_changes;
  select coalesce(array_agg(k2), '{}') into v_changed from unnest(v_allowed) k2 where (v_orig->k2) is distinct from (v_new->k2);
  if cardinality(v_changed) = 0 and not p_accept_issues then
    raise exception 'ingen_endring: Ingen felt er endret.' using errcode = '22023';
  end if;
  v_identity := v_changed && array['supplier_sku','description','line_kind'];

  v_issues := rm_line_read_issues_v2((v_new->>'quantity')::numeric, v_new->>'unit', (v_new->>'unit_price')::numeric, (v_new->>'total_amount')::numeric,
    (v_new->>'package_size')::numeric, v_new->>'package_unit', (v_new->>'count_per_package')::numeric, coalesce(v.is_credit_note,false),
    v_new->>'unit_price_basis', (v_new->>'discount_amount')::numeric, v_new->>'line_kind');
  if p_accept_issues then v_accepted := v_issues || coalesce(l.extraction_issues, '[]'::jsonb); v_issues := '[]'::jsonb; end if;

  perform set_config('rm.read_issue_write', 'on', true);
  update invoice_lines set
    supplier_sku = v_new->>'supplier_sku', description = v_new->>'description',
    quantity = (v_new->>'quantity')::numeric, unit = v_new->>'unit',
    package_size = (v_new->>'package_size')::numeric, package_unit = v_new->>'package_unit',
    count_per_package = (v_new->>'count_per_package')::numeric,
    unit_price = (v_new->>'unit_price')::numeric, total_amount = (v_new->>'total_amount')::numeric,
    line_kind = v_new->>'line_kind', unit_price_basis = v_new->>'unit_price_basis', discount_amount = (v_new->>'discount_amount')::numeric,
    price_per_base_unit = null, expected_price_per_base_unit = null, price_variance_pct = null, variance_status = null,
    base_quantity = null, price_acceptance = null, price_reference_source = null, price_reference_id = null,
    price_reference_date = null, package_source_rms_id = null,
    raw_material_id = case when v_identity then null when match_confidence::text = 'manual' then raw_material_id else null end,
    match_confidence = case when v_identity then null when match_confidence::text in ('manual','not_applicable') then match_confidence else null end,
    requires_review = case when not v_identity and match_confidence::text = 'not_applicable' then false else true end,
    review_reason = null, resolved_at = null, resolved_by = null, resolution_note = null,
    extraction_issues = v_issues
  where id = l.id
  returning updated_at into v_upd;

  select rm_lines_sum_check(sum(total_amount), count(*)::int, v.total_amount, v.total_vat) into v_sum
    from invoice_lines where invoice_id = v.id;
  update invoices set
    lines_sum_excl_vat = (v_sum->>'lines_sum_excl_vat')::numeric,
    lines_sum_variance_pct = (v_sum->>'lines_sum_variance_pct')::numeric,
    lines_sum_status = v_sum->>'lines_sum_status',
    status = case when status = 'ready' then 'needs_review' else status end,
    updated_at = now()
  where id = v.id;
  perform set_config('rm.read_issue_write', '', true);

  insert into invoice_line_corrections (legal_entity_id, invoice_id, invoice_line_id, supplier_id, original, corrected, changed_fields, reason, accepted_issues, learn, corrected_by)
  values (v.legal_entity_id, v.id, l.id, v.supplier_id, v_orig, v_new, v_changed, btrim(p_reason), v_accepted, coalesce(p_learn,false) and v.supplier_id is not null, v_uid)
  returning id into v_corr;

  if coalesce(p_learn,false) and v.supplier_id is not null and cardinality(v_changed) > 0 then
    v_ex_active := jsonb_array_length(v_accepted) = 0 and jsonb_array_length(v_issues) = 0;
    insert into invoice_extraction_examples (legal_entity_id, supplier_id, supplier_sku_norm, description_key, original, corrected, note, source_correction_id, created_by, is_active, accepted_issues)
    values (v.legal_entity_id, v.supplier_id, nullif(rm_sku_norm(v_new->>'supplier_sku'), ''), nullif(rm_match_key(coalesce(v_new->>'description','')), ''),
            v_orig, v_new, btrim(p_reason), v_corr, v_uid, v_ex_active, v_accepted)
    returning id into v_ex;
    update invoice_line_corrections set example_id = v_ex where id = v_corr;
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'invoice_line.corrected', 'invoice_line', l.id, v.invoice_number, v.legal_entity_id,
          jsonb_build_object('invoice_id', v.id, 'before', v_orig, 'after', v_new, 'fields', to_jsonb(v_changed),
                             'accepted_issues', v_accepted, 'example_id', v_ex, 'example_active', case when v_ex is null then null else v_ex_active end, 'correction_id', v_corr), btrim(p_reason), 'ravarer'),
         (v_uid, 'invoice.line_corrected', 'invoice', v.id, v.invoice_number, v.legal_entity_id,
          jsonb_build_object('line_id', l.id, 'line_number', l.line_number, 'fields', to_jsonb(v_changed), 'correction_id', v_corr), btrim(p_reason), 'ravarer');

  perform rm_rematch_invoices(v.legal_entity_id, 1, array[v.id], true);

  return jsonb_build_object('ok', true, 'correction_id', v_corr, 'example_id', v_ex,
                            'example_active', case when v_ex is null then null else v_ex_active end, 'changed', to_jsonb(v_changed),
                            'remaining_issues', v_issues, 'updated_at', v_upd, 'lines_sum_status', v_sum->>'lines_sum_status');
end $function$;