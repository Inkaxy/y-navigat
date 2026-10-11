ALTER TABLE public.invoice_lines ADD COLUMN IF NOT EXISTS unit_price_basis text;
ALTER TABLE public.invoice_lines ADD COLUMN IF NOT EXISTS discount_amount numeric;
ALTER TABLE public.invoice_extraction_examples ADD COLUMN IF NOT EXISTS accepted_issues jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public._rm_basis_ok() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
begin
  if new.unit_price_basis is not null and new.unit_price_basis not in ('mengdeenhet','pakning','stk','kg','g','l','ml') then
    raise exception 'ugyldig_prisgrunnlag' using errcode = '22023';
  end if;
  if new.discount_amount is not null and (not public.rm_is_finite(new.discount_amount) or new.discount_amount < 0) then
    raise exception 'ugyldig_rabatt: Rabatt oppgis som positivt kronebeløp' using errcode = '22023';
  end if;
  return new;
end $$;
REVOKE EXECUTE ON FUNCTION public._rm_basis_ok() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_invoice_lines_basis_ok ON public.invoice_lines;
CREATE TRIGGER trg_invoice_lines_basis_ok BEFORE INSERT OR UPDATE OF unit_price_basis, discount_amount ON public.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public._rm_basis_ok();

CREATE OR REPLACE FUNCTION public.rm_line_read_issues_v2(p_quantity numeric, p_unit text, p_unit_price numeric, p_total numeric,
  p_package_size numeric, p_package_unit text, p_count_per_package numeric, p_is_credit boolean,
  p_basis text, p_discount numeric, p_line_kind text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
declare
  v_kind text := coalesce(nullif(lower(btrim(p_line_kind)), ''), 'vare');
  v_basis text := nullif(lower(btrim(p_basis)), '');
  v_unit text := lower(coalesce(p_unit, ''));
  v_pu text := lower(coalesce(p_package_unit, ''));
  v_tol numeric; v_pkg numeric; v_disc numeric := coalesce(p_discount, 0);
  v_plain numeric; v_expected numeric; v_qb numeric; v_f numeric; c numeric;
  v_alt text[] := '{}';
  function_measure constant text[] := array['g','kg','ml','cl','dl','l'];
begin
  if p_total is null then
    return jsonb_build_array(jsonb_build_object('code','linjesum_mangler','message','Linjesummen mangler. Les den av originalen.'));
  end if;
  if not public.rm_is_finite(p_total)
     or (p_quantity is not null and not public.rm_is_finite(p_quantity))
     or (p_unit_price is not null and not public.rm_is_finite(p_unit_price)) then
    return jsonb_build_array(jsonb_build_object('code','ugyldig_tall','message','Et tall på linjen er ikke gyldig.'));
  end if;

  -- Fortegn for linjer uten regnestykke: rabatt skal være negativ på vanlig faktura.
  if v_kind = 'rabatt' and not p_is_credit and p_total > 0 then
    return jsonb_build_array(jsonb_build_object('code','fortegn','message','Rabattlinjen har positivt beløp på en vanlig faktura. Kontroller fortegnet mot originalen.'));
  end if;

  if p_quantity is null or p_unit_price is null then
    -- Særregel: frakt, gebyr, avrunding, mva, pant, rabatt og annet kan ha bare beløp.
    if v_kind <> 'vare' then return '[]'::jsonb; end if;
    return jsonb_build_array(jsonb_build_object('code','mengde_eller_pris_mangler',
      'message', case when p_quantity is null and p_unit_price is null then 'Mengde og enhetspris mangler. Les dem av originalen.'
                      when p_quantity is null then 'Mengden mangler. Les den av originalen.' else 'Enhetsprisen mangler. Les den av originalen.' end));
  end if;
  if p_quantity = 0 and p_total <> 0 then
    return jsonb_build_array(jsonb_build_object('code','mengde_null','message','Mengden er 0, men linjen har et beløp.'));
  end if;

  v_tol := greatest(0.02, 0.015 * abs(p_total));
  v_plain := p_quantity * p_unit_price;
  v_pkg := case when public.rm_is_finite(p_package_size) and p_package_size > 0 then p_package_size * coalesce(nullif(p_count_per_package, 0), 1) end;

  -- Forventet beløp etter oppgitt prisgrunnlag.
  if v_basis is null or v_basis = 'mengdeenhet' then
    v_expected := v_plain;
  elsif v_basis = 'pakning' then
    if v_unit = any(function_measure) and v_pkg is not null and public.rm_read_unit_factor(v_unit, v_pu) is not null then
      v_expected := p_quantity * public.rm_read_unit_factor(v_unit, v_pu) / v_pkg * p_unit_price;
    else v_expected := v_plain; end if;
  elsif v_basis = 'stk' then
    v_expected := case when p_count_per_package is not null and p_count_per_package > 0 and not (v_unit = any(function_measure)) and v_unit not in ('stk','st')
                       then p_quantity * p_count_per_package * p_unit_price else v_plain end;
  else
    -- kg/g/l/ml: mengde omregnet til prisgrunnlaget.
    v_f := public.rm_read_unit_factor(v_unit, v_basis);
    if v_f is not null then v_qb := p_quantity * v_f;
    elsif v_pkg is not null and public.rm_read_unit_factor(v_pu, v_basis) is not null then v_qb := p_quantity * v_pkg * public.rm_read_unit_factor(v_pu, v_basis);
    end if;
    if v_qb is null then
      return jsonb_build_array(jsonb_build_object('code','prisgrunnlag_uavklart',
        'message', format('Prisen er per %s, men mengden kan ikke regnes om (mangler pakning i vekt/volum).', v_basis)));
    end if;
    v_expected := v_qb * p_unit_price;
  end if;

  -- Rabatt i kr trekkes fra i samme retning som beløpet.
  if v_disc > 0 then v_expected := v_expected - sign(v_expected) * v_disc; end if;

  if abs(v_expected - p_total) <= v_tol then return '[]'::jsonb; end if;
  if p_is_credit and abs(-v_expected - p_total) <= v_tol then return '[]'::jsonb; end if;
  if not p_is_credit and abs(abs(v_expected) - abs(p_total)) <= v_tol then
    return jsonb_build_array(jsonb_build_object('code','fortegn',
      'message', format('Beløpet %s har motsatt fortegn av mengde × pris (%s) på en vanlig faktura. Kontroller retur/rabatt mot originalen.', round(p_total, 2), round(v_expected, 2))));
  end if;

  -- Ukjent prisgrunnlag: finn grunnlag som ville passet, men godta det ikke.
  if v_basis is null and v_pkg is not null then
    foreach c in array array[
      p_quantity * v_pkg * p_unit_price,
      p_quantity * v_pkg * coalesce(public.rm_read_unit_factor(v_pu, case v_pu when 'g' then 'kg' when 'ml' then 'l' when 'cl' then 'l' when 'dl' then 'l' else null end), 0) * p_unit_price,
      case when v_unit = any(function_measure) and public.rm_read_unit_factor(v_unit, v_pu) is not null then p_quantity * public.rm_read_unit_factor(v_unit, v_pu) / v_pkg * p_unit_price end,
      case when p_count_per_package > 0 then p_quantity * p_count_per_package * p_unit_price end] loop
      if c is not null and c <> 0 and (abs(c - p_total) <= v_tol or (p_is_credit and abs(-c - p_total) <= v_tol)) then
        return jsonb_build_array(jsonb_build_object('code','prisgrunnlag_uavklart',
          'message', format('Mengde × pris (%s) stemmer ikke, men summen passer med pris per pakning/vekt (%s). Angi prisgrunnlaget i «Rett fakturalinje».', round(v_plain, 2), round(c, 2))));
      end if;
    end loop;
  end if;

  if abs(p_total) < abs(v_expected) and abs(p_total) >= 0.5 * abs(v_expected) and sign(p_total) = sign(v_expected) and v_disc = 0 then
    return jsonb_build_array(jsonb_build_object('code','mulig_rabatt',
      'message', format('Linjesummen %s er lavere enn mengde × pris (%s). Registrer rabatten eller kontroller mot originalen.', round(p_total, 2), round(v_expected, 2))));
  end if;
  return jsonb_build_array(jsonb_build_object('code','regnestykke',
    'message', format('Mengde × pris (%s) stemmer ikke med linjesummen (%s).', round(v_expected, 2), round(p_total, 2))));
end $function$;

CREATE OR REPLACE FUNCTION public.rm_line_read_issues(p_quantity numeric, p_unit text, p_unit_price numeric, p_total numeric,
  p_package_size numeric, p_package_unit text, p_count_per_package numeric, p_is_credit boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ select public.rm_line_read_issues_v2(p_quantity, p_unit, p_unit_price, p_total, p_package_size, p_package_unit, p_count_per_package, coalesce(p_is_credit,false), null, null, null) $$;
REVOKE EXECUTE ON FUNCTION public.rm_line_read_issues_v2(numeric,text,numeric,numeric,numeric,text,numeric,boolean,text,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rm_line_read_issues_v2(numeric,text,numeric,numeric,numeric,text,numeric,boolean,text,numeric,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_invoice_lines_read_issues()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_credit boolean;
begin
  if tg_op = 'INSERT' then
    if jsonb_array_length(coalesce(new.extraction_issues,'[]'::jsonb)) = 0 then
      select coalesce(is_credit_note,false) into v_credit from public.invoices where id = new.invoice_id;
      new.extraction_issues := public.rm_line_read_issues_v2(new.quantity, new.unit, new.unit_price, new.total_amount,
        new.package_size, new.package_unit, new.count_per_package, coalesce(v_credit,false),
        new.unit_price_basis, new.discount_amount, new.line_kind);
    end if;
  elsif new.extraction_issues is distinct from old.extraction_issues
        and coalesce(current_setting('rm.read_issue_write', true), '') <> 'on'
        and auth.uid() is not null then
    new.extraction_issues := old.extraction_issues;
  end if;
  new.extraction_issues := coalesce(new.extraction_issues, '[]'::jsonb);
  if jsonb_array_length(new.extraction_issues) > 0 and coalesce(new.match_confidence::text,'') <> 'not_applicable' then
    new.requires_review := true;
    if coalesce(new.review_reason,'') !~ 'extraction_issue' then
      new.review_reason := concat_ws(',', nullif(new.review_reason,''), 'extraction_issue');
    end if;
  end if;
  return new;
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
    -- Rettelse med godtatte, uavklarte regne-/enhetsavvik læres ikke automatisk: lagres avslått og må slås på manuelt.
    v_ex_active := jsonb_array_length(v_accepted) = 0;
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