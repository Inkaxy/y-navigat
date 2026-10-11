-- Del 2: lesevarsler blokkerer automatisk avstemming/kostpris; rettelse, læring og kladder via RPC.

revoke execute on function public.trg_invoice_lines_read_issues() from public, anon, authenticated;
revoke execute on function public.trg_invoices_read_issues() from public, anon, authenticated;
revoke execute on function public.rm_invoice_has_read_issues(uuid) from authenticated;

-- invoice_approval_blockers: + 'lesefeil'
CREATE OR REPLACE FUNCTION public.invoice_approval_blockers(p_invoice_id uuid)
 RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v invoices%rowtype; b text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN ARRAY['finnes_ikke']::text[]; END IF;
  IF v.flagged_at IS NOT NULL THEN b := array_append(b, 'flagget'); END IF;
  IF v.status = 'cancelled' THEN b := array_append(b, 'kansellert'); END IF;
  IF v.supplier_id IS NULL THEN b := array_append(b, 'leverandor_mangler'); END IF;
  IF NOT rm_is_finite(v.total_amount) THEN b := array_append(b, 'belop_mangler'); END IF;
  IF NOT rm_is_finite(v.total_vat) THEN b := array_append(b, 'mva_ukjent'); END IF;
  IF coalesce(trim(v.currency),'') = '' THEN b := array_append(b, 'valuta_mangler'); END IF;
  IF NOT EXISTS (SELECT 1 FROM invoice_lines WHERE invoice_id = v.id) THEN
    b := array_append(b, 'mangler_linjer');
  ELSIF v.lines_sum_status = 'mismatch' THEN
    b := array_append(b, 'sumavvik');
  ELSIF coalesce(v.lines_sum_status,'') <> 'ok' THEN
    b := array_append(b, 'sum_ukontrollert');
  END IF;
  IF v.extraction_confidence IS NOT NULL AND v.extraction_confidence < 0.6 THEN b := array_append(b, 'lavt_uttrekk'); END IF;
  IF rm_invoice_has_read_issues(v.id) THEN b := array_append(b, 'lesefeil'); END IF;
  IF EXISTS (SELECT 1 FROM invoices o WHERE o.id <> v.id AND o.legal_entity_id = v.legal_entity_id
             AND o.supplier_id IS NOT DISTINCT FROM v.supplier_id AND o.invoice_number = v.invoice_number
             AND coalesce(o.is_credit_note,false) = coalesce(v.is_credit_note,false) AND coalesce(o.status,'') <> 'cancelled') THEN
    b := array_append(b, 'duplikat');
  END IF;
  IF EXISTS (SELECT 1 FROM invoice_lines il WHERE il.invoice_id = v.id
             AND coalesce(il.match_confidence::text,'') <> 'not_applicable'
             AND (il.review_reason ~ '(extraction_issue|extraction_unresolved|zero_quantity)'
               OR (rm_is_finite(il.quantity) AND rm_is_finite(il.unit_price) AND rm_is_finite(il.total_amount)
                   AND il.quantity > 0 AND il.total_amount <> 0
                   AND abs(il.quantity * il.unit_price - il.total_amount) > 0.015 * abs(il.total_amount)
                   AND NOT (rm_is_finite(il.base_quantity) AND il.base_quantity > 0
                            AND abs(il.base_quantity * il.unit_price - il.total_amount) <= 0.015 * abs(il.total_amount))))) THEN
    b := array_append(b, 'mengde');
  END IF;
  IF EXISTS (SELECT 1 FROM invoice_lines il WHERE il.invoice_id = v.id AND coalesce(il.requires_review,false)
             AND il.review_reason ~ '(price_variance|price_increase|price_drop|agreement_conflict)'
             AND NOT public.invoice_line_credit_covered(il.id)) THEN
    b := array_append(b, 'prisavvik');
  END IF;
  IF EXISTS (SELECT 1 FROM supplier_deviation_case_lines l JOIN supplier_deviation_cases c ON c.id = l.case_id
             WHERE l.invoice_id = v.id AND c.status = 'open'
             AND public.supplier_case_invoice_remaining(c.id, v.id) > 0.005) THEN
    b := array_append(b, 'leverandorsak');
  END IF;
  RETURN b;
END $function$;

-- _rm_reconcile_core: uavklarte lesevarsler stopper både automatisk og manuell avstemming.
CREATE OR REPLACE FUNCTION public._rm_reconcile_core(p_invoice_id uuid, p_uid uuid, p_mode text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_inv invoices%rowtype;
  v_bad int;
  r record;
  v_written int := 0;
  v_skipped int := 0;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Fakturaen finnes ikke' using errcode = 'P0002';
  end if;

  perform 1 from public.invoice_lines where invoice_id = v_inv.id order by id for update;

  if v_inv.status = 'reconciled' then
    return jsonb_build_object('ok', true, 'already_reconciled', true, 'history_written', 0,
                              'is_credit_note', coalesce(v_inv.is_credit_note, false));
  end if;

  if v_inv.flagged_at is not null then
    raise exception 'Fakturaen er flagget for oppfølging og kan ikke bekreftes';
  end if;
  if v_inv.supplier_id is null then
    raise exception 'Fakturaen mangler leverandør — prishistorikken kan ikke føres';
  end if;
  perform 1 from public.suppliers s
   where s.id = v_inv.supplier_id and s.legal_entity_id = v_inv.legal_entity_id;
  if not found then
    raise exception 'Leverandøren tilhører et annet selskap enn fakturaen' using errcode = '42501';
  end if;
  if upper(coalesce(v_inv.currency, 'NOK')) <> 'NOK' then
    raise exception 'Fakturaen er i % — prishistorikken føres i NOK', upper(v_inv.currency);
  end if;
  if v_inv.status not in ('imported', 'needs_review', 'ready') then
    raise exception 'Fakturaen har status «%» og kan ikke bekreftes herfra', v_inv.status;
  end if;

  if public.rm_invoice_has_read_issues(v_inv.id) then
    if p_mode = 'auto' then
      return jsonb_build_object('ok', false, 'reason', 'lesefeil');
    end if;
    raise exception 'Fakturaen har uavklarte lesevarsler. Rett linjene eller bekreft lesingen mot originalen først.';
  end if;

  if p_mode = 'auto' then
    if coalesce(v_inv.is_credit_note, false) then
      return jsonb_build_object('ok', false, 'reason', 'kreditnota');
    end if;
    if coalesce(v_inv.lines_sum_status, '') <> 'ok' then
      return jsonb_build_object('ok', false, 'reason', 'sum_ikke_dokumentert');
    end if;
    if coalesce(v_inv.extraction_confidence, 1) < 0.6 then
      return jsonb_build_object('ok', false, 'reason', 'lavt_uttrekk');
    end if;
    if exists (select 1 from public.invoices o where o.id <> v_inv.id and o.legal_entity_id = v_inv.legal_entity_id
                and o.supplier_id is not distinct from v_inv.supplier_id and o.invoice_number = v_inv.invoice_number
                and coalesce(o.is_credit_note,false) = coalesce(v_inv.is_credit_note,false) and coalesce(o.status,'') <> 'cancelled') then
      return jsonb_build_object('ok', false, 'reason', 'duplikat');
    end if;
  end if;

  select count(*) into v_bad
    from public.invoice_lines il
   where il.invoice_id = v_inv.id
     and coalesce(il.match_confidence::text, '') <> 'not_applicable'
     and (coalesce(il.requires_review, false)
          or il.raw_material_id is null
          or coalesce(il.match_confidence::text, '') not in ('auto_high', 'auto_medium', 'auto_low', 'manual')
          or not public.rm_is_finite(il.price_per_base_unit)
          or il.price_per_base_unit < 0
          or (il.base_quantity is not null and not public.rm_is_finite(il.base_quantity))
          or (coalesce(v_inv.is_credit_note, false) = false
              and il.base_quantity is not null and il.base_quantity < 0));
  if v_bad > 0 then
    if p_mode = 'auto' then
      return jsonb_build_object('ok', false, 'reason', 'linjer_ikke_klare', 'lines', v_bad);
    end if;
    raise exception '% linjer mangler råvare, gjennomgang, gyldig mengde eller gyldig pris per grunnenhet', v_bad;
  end if;

  select count(*) into v_bad
    from public.invoice_lines il
    join public.raw_materials rm on rm.id = il.raw_material_id
   where il.invoice_id = v_inv.id
     and rm.legal_entity_id <> v_inv.legal_entity_id;
  if v_bad > 0 then
    raise exception '% linjer peker på råvarer i et annet selskap', v_bad;
  end if;

  perform set_config('rm.defer_stats', 'on', true);

  update public.invoices
     set status = 'reconciled',
         reconciled_at = now(),
         reconciled_by = p_uid,
         reconciled_mode = p_mode,
         updated_at = now()
   where id = v_inv.id;

  for r in
    select il.id, il.raw_material_id
      from public.invoice_lines il
     where il.invoice_id = v_inv.id
       and il.raw_material_id is not null
       and coalesce(il.match_confidence::text, '') <> 'not_applicable'
     order by il.id
  loop
    if public.fn_rm_price_history_upsert_line(r.id) then
      v_written := v_written + 1;
      perform public.rm_apply_derived_cost_price(r.raw_material_id);
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  if v_skipped > 0 then
    raise exception '% linjer kunne ikke føres i prishistorikken — avstemmingen er avbrutt', v_skipped;
  end if;

  perform set_config('rm.defer_stats', '', true);
  perform public.refresh_purchase_stats();

  insert into public.audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
  values (p_uid, case when p_mode = 'auto' then 'invoice.auto_reconciled' else 'invoice.reconciled' end,
          'invoice', v_inv.id, v_inv.invoice_number, v_inv.legal_entity_id,
          jsonb_build_object('history_written', v_written, 'mode', p_mode),
          case when p_mode = 'auto' then 'Automatisk avstemt: alle linjer koblet, pris innenfor toleranse, sum dokumentert' else 'Prismatch bekreftet' end,
          'ravarer');

  return jsonb_build_object(
    'ok', true,
    'already_reconciled', false,
    'history_written', v_written,
    'is_credit_note', coalesce(v_inv.is_credit_note, false),
    'mode', p_mode
  );
end;
$function$;

-- rm_post_safe_line_costs: 'lesefeil' sperrer føringen (resten uendret).
CREATE OR REPLACE FUNCTION public.rm_post_safe_line_costs(p_invoice_id uuid, p_line_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v invoices%rowtype; v_uid uuid := auth.uid(); r record; v_reasons text[]; v_first boolean; v_posted int := 0;
  v_skipped jsonb := '[]'::jsonb; b text[]; v_pkg_ok boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'finnes_ikke' USING ERRCODE = 'P0002'; END IF;
  IF NOT has_ravarer_invoice_access(v.legal_entity_id, 'write') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM invoice_lines WHERE invoice_id = v.id ORDER BY id FOR UPDATE;
  IF coalesce(v.is_credit_note,false) THEN RAISE EXCEPTION 'kreditnota'; END IF;
  IF v.status NOT IN ('imported','needs_review','ready') THEN RAISE EXCEPTION 'faktura_status'; END IF;
  IF v.currency IS NULL OR upper(v.currency) <> 'NOK' THEN RAISE EXCEPTION 'valuta'; END IF;
  b := invoice_approval_blockers(v.id);
  IF b && ARRAY['flagget','sumavvik','duplikat','mangler_linjer','sum_ukontrollert','lavt_uttrekk','leverandor_mangler','belop_mangler','lesefeil']::text[] THEN
    RETURN jsonb_build_object('ok', false, 'blockers', to_jsonb(b));
  END IF;
  PERFORM set_config('rm.defer_stats', 'on', true);
  FOR r IN SELECT il.*, rm.legal_entity_id AS rm_entity, rm.base_unit AS rm_base_unit
             FROM invoice_lines il LEFT JOIN raw_materials rm ON rm.id = il.raw_material_id
            WHERE il.invoice_id = v.id AND (p_line_ids IS NULL OR il.id = ANY(p_line_ids))
              AND coalesce(il.match_confidence::text,'') <> 'not_applicable'
              AND NOT EXISTS (SELECT 1 FROM invoice_line_cost_postings p WHERE p.invoice_line_id = il.id AND p.revoked_at IS NULL)
            ORDER BY il.id LOOP
    v_reasons := array_remove(string_to_array(coalesce(r.review_reason,''), ','), '');
    v_first := false;
    IF r.raw_material_id IS NULL OR coalesce(r.match_confidence::text,'') NOT IN ('manual','auto_high') OR r.rm_entity IS DISTINCT FROM v.legal_entity_id THEN
      v_skipped := v_skipped || jsonb_build_object('line_id', r.id, 'reason', 'raavare_ikke_bekreftet'); CONTINUE;
    END IF;
    IF NOT rm_is_finite(r.price_per_base_unit) OR r.price_per_base_unit <= 0 OR NOT rm_is_finite(r.base_quantity) OR r.base_quantity <= 0
       OR NOT rm_is_finite(r.total_amount) OR r.total_amount <= 0 THEN
      v_skipped := v_skipped || jsonb_build_object('line_id', r.id, 'reason', 'pris_eller_mengde_mangler'); CONTINUE;
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM (
        SELECT NULL::numeric AS bupp
        UNION ALL SELECT s.base_units_per_package FROM raw_material_suppliers s
          WHERE s.raw_material_id = r.raw_material_id AND s.supplier_id = v.supplier_id AND s.package_confirmed_at IS NOT NULL
        UNION ALL SELECT p.base_units_per_package FROM raw_material_supplier_packages p JOIN raw_material_suppliers s ON s.id = p.raw_material_supplier_id
          WHERE s.raw_material_id = r.raw_material_id AND s.supplier_id = v.supplier_id
            AND (p.supplier_sku_norm = '' OR p.supplier_sku_norm = rm_sku_norm(r.supplier_sku))
      ) x
      WHERE (rm_expected_base_quantity(r.quantity, r.unit, r.rm_base_unit, x.bupp)->>'status') = 'ok'
        AND abs((rm_expected_base_quantity(r.quantity, r.unit, r.rm_base_unit, x.bupp)->>'expected')::numeric - r.base_quantity) <= 0.0005 * greatest(1, r.base_quantity)
    ) INTO v_pkg_ok;
    IF NOT v_pkg_ok THEN
      v_skipped := v_skipped || jsonb_build_object('line_id', r.id, 'reason', 'pakning_ikke_bekreftet'); CONTINUE;
    END IF;
    IF abs(r.price_per_base_unit * r.base_quantity - r.total_amount) > 0.01 * r.total_amount
       OR (rm_is_finite(r.quantity) AND rm_is_finite(r.unit_price) AND r.quantity > 0
           AND abs(r.quantity * r.unit_price - r.total_amount) > 0.015 * r.total_amount
           AND abs(r.base_quantity * r.unit_price - r.total_amount) > 0.015 * r.total_amount) THEN
      v_skipped := v_skipped || jsonb_build_object('line_id', r.id, 'reason', 'regnestykket_stemmer_ikke'); CONTINUE;
    END IF;
    IF coalesce(r.requires_review,false) OR coalesce(array_length(v_reasons,1),0) > 0 THEN
      IF coalesce(array_length(v_reasons,1),0) > 0 AND v_reasons <@ ARRAY['no_automatic_basis','no_baseline']::text[] THEN
        v_first := true;
      ELSE
        v_skipped := v_skipped || jsonb_build_object('line_id', r.id, 'reason', 'til_gjennomgang'); CONTINUE;
      END IF;
    END IF;
    IF v_first THEN
      UPDATE invoice_lines SET requires_review = false, review_reason = NULL, resolution_note = 'Første dokumenterte kostpris',
        resolved_by = v_uid, resolved_at = now(), updated_at = now() WHERE id = r.id;
    END IF;
    INSERT INTO invoice_line_cost_postings (invoice_line_id, invoice_id, legal_entity_id, first_cost, posted_by)
    VALUES (r.id, v.id, v.legal_entity_id, v_first, v_uid)
    ON CONFLICT (invoice_line_id) DO UPDATE SET revoked_at = NULL, posted_by = EXCLUDED.posted_by, posted_at = now(), first_cost = EXCLUDED.first_cost;
    IF fn_rm_price_history_upsert_line(r.id) THEN
      PERFORM rm_apply_derived_cost_price(r.raw_material_id);
      v_posted := v_posted + 1;
    ELSE
      RAISE EXCEPTION 'prishistorikk_feilet';
    END IF;
  END LOOP;
  PERFORM set_config('rm.defer_stats', '', true);
  IF v_posted > 0 THEN PERFORM refresh_purchase_stats(); END IF;
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  VALUES (v_uid, 'invoice.safe_costs_posted', 'invoice', v.id, v.legal_entity_id, jsonb_build_object('posted', v_posted, 'skipped', v_skipped), 'Trygge kostprislinjer ført', 'ravarer');
  RETURN jsonb_build_object('ok', true, 'posted', v_posted, 'skipped', v_skipped);
END $function$;

-- Oversikten får antall varelinjer, så delvis føring kan vises (ny kolonne sist).
DROP FUNCTION IF EXISTS public.invoice_approval_overview(uuid);
CREATE FUNCTION public.invoice_approval_overview(p_legal_entity_id uuid)
 RETURNS TABLE(invoice_id uuid, invoice_number text, invoice_date date, supplier_id uuid, supplier_name text, total_amount numeric, total_vat numeric, currency text, status text, is_credit_note boolean, approved_at timestamp with time zone, approved_by uuid, blockers text[], open_material_lines integer, cost_posted_lines integer, cost_line_total integer)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_ravarer_invoice_access(p_legal_entity_id, 'read') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT i.id, i.invoice_number::text, i.invoice_date::date, i.supplier_id, s.name::text, i.total_amount, i.total_vat, i.currency::text,
         i.status::text, coalesce(i.is_credit_note,false), a.approved_at, a.approved_by,
         invoice_approval_blockers(i.id),
         (SELECT count(*)::int FROM invoice_lines il WHERE il.invoice_id = i.id AND coalesce(il.match_confidence::text,'') <> 'not_applicable'
            AND (il.raw_material_id IS NULL OR coalesce(il.match_confidence::text,'') NOT IN ('manual','auto_high'))),
         (SELECT count(*)::int FROM invoice_line_cost_postings p WHERE p.invoice_id = i.id AND p.revoked_at IS NULL),
         (SELECT count(*)::int FROM invoice_lines il WHERE il.invoice_id = i.id AND coalesce(il.match_confidence::text,'') <> 'not_applicable')
    FROM invoices i
    LEFT JOIN suppliers s ON s.id = i.supplier_id
    LEFT JOIN invoice_internal_approvals a ON a.invoice_id = i.id AND a.status = 'approved'
   WHERE i.legal_entity_id = p_legal_entity_id AND coalesce(i.status,'') <> 'cancelled'
   ORDER BY i.invoice_date DESC NULLS LAST, i.id;
END $function$;
revoke execute on function public.invoice_approval_overview(uuid) from public, anon;
grant execute on function public.invoice_approval_overview(uuid) to authenticated, service_role;

-- Rett én fakturalinje transaksjonelt.
create or replace function public.rm_correct_invoice_line(
  p_line_id uuid, p_expected_updated_at timestamptz, p_changes jsonb, p_reason text,
  p_learn boolean default false, p_accept_issues boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_inv_id uuid; v invoices%rowtype; l invoice_lines%rowtype;
  v_allowed text[] := array['supplier_sku','description','quantity','unit','package_size','package_unit','count_per_package','unit_price','total_amount','line_kind'];
  v_numeric text[] := array['quantity','package_size','count_per_package','unit_price','total_amount'];
  v_kinds text[] := array['vare','pant','frakt','gebyr','rabatt','avrunding','mva','annet'];
  k text; v_num numeric; v_orig jsonb; v_new jsonb; v_changed text[] := '{}'; v_identity boolean;
  v_issues jsonb; v_accepted jsonb := '[]'::jsonb; v_sum jsonb; v_corr uuid; v_ex uuid := null; v_upd timestamptz;
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
    end if;
    if k = 'line_kind' and jsonb_typeof(p_changes->k) <> 'null' and not (p_changes->>k) = any(v_kinds) then
      raise exception 'ugyldig_linjetype' using errcode = '22023';
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

  v_issues := rm_line_read_issues((v_new->>'quantity')::numeric, v_new->>'unit', (v_new->>'unit_price')::numeric, (v_new->>'total_amount')::numeric,
    (v_new->>'package_size')::numeric, v_new->>'package_unit', (v_new->>'count_per_package')::numeric, coalesce(v.is_credit_note,false));
  if p_accept_issues then v_accepted := v_issues || coalesce(l.extraction_issues, '[]'::jsonb); v_issues := '[]'::jsonb; end if;

  perform set_config('rm.read_issue_write', 'on', true);
  update invoice_lines set
    supplier_sku = v_new->>'supplier_sku', description = v_new->>'description',
    quantity = (v_new->>'quantity')::numeric, unit = v_new->>'unit',
    package_size = (v_new->>'package_size')::numeric, package_unit = v_new->>'package_unit',
    count_per_package = (v_new->>'count_per_package')::numeric,
    unit_price = (v_new->>'unit_price')::numeric, total_amount = (v_new->>'total_amount')::numeric,
    line_kind = v_new->>'line_kind',
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
    insert into invoice_extraction_examples (legal_entity_id, supplier_id, supplier_sku_norm, description_key, original, corrected, note, source_correction_id, created_by)
    values (v.legal_entity_id, v.supplier_id, nullif(rm_sku_norm(v_new->>'supplier_sku'), ''), nullif(rm_match_key(coalesce(v_new->>'description','')), ''),
            v_orig, v_new, btrim(p_reason), v_corr, v_uid)
    returning id into v_ex;
    update invoice_line_corrections set example_id = v_ex where id = v_corr;
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'invoice_line.corrected', 'invoice_line', l.id, v.invoice_number, v.legal_entity_id,
          jsonb_build_object('invoice_id', v.id, 'before', v_orig, 'after', v_new, 'fields', to_jsonb(v_changed),
                             'accepted_issues', v_accepted, 'example_id', v_ex, 'correction_id', v_corr), btrim(p_reason), 'ravarer'),
         (v_uid, 'invoice.line_corrected', 'invoice', v.id, v.invoice_number, v.legal_entity_id,
          jsonb_build_object('line_id', l.id, 'line_number', l.line_number, 'fields', to_jsonb(v_changed), 'correction_id', v_corr), btrim(p_reason), 'ravarer');

  perform rm_rematch_invoices(v.legal_entity_id, 1, array[v.id], true);

  return jsonb_build_object('ok', true, 'correction_id', v_corr, 'example_id', v_ex, 'changed', to_jsonb(v_changed),
                            'remaining_issues', v_issues, 'updated_at', v_upd, 'lines_sum_status', v_sum->>'lines_sum_status');
end $$;
revoke execute on function public.rm_correct_invoice_line(uuid, timestamptz, jsonb, text, boolean, boolean) from public, anon;
grant execute on function public.rm_correct_invoice_line(uuid, timestamptz, jsonb, text, boolean, boolean) to authenticated;

-- Bekreft lesevarsler på fakturanivå etter kontroll mot originalen (beløp endres ikke).
create or replace function public.rm_confirm_invoice_read_issues(p_invoice_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v invoices%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into v from invoices where id = p_invoice_id for update;
  if not found then raise exception 'finnes_ikke' using errcode = 'P0002'; end if;
  if not has_ravarer_invoice_access(v.legal_entity_id, 'write') then raise exception 'forbidden: Mangler skrivetilgang til fakturaer' using errcode = '42501'; end if;
  if v.status not in ('imported','needs_review','ready') then raise exception 'faktura_last: Fakturaen er avstemt eller lukket.' using errcode = '55000'; end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'begrunnelse: Skriv en begrunnelse.' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(v.extraction_issues,'[]'::jsonb)) = 0 then return jsonb_build_object('ok', true, 'already', true); end if;
  perform set_config('rm.read_issue_write', 'on', true);
  update invoices set extraction_issues = '[]'::jsonb, updated_at = now() where id = v.id;
  perform set_config('rm.read_issue_write', '', true);
  insert into audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'invoice.read_issues_confirmed', 'invoice', v.id, v.invoice_number, v.legal_entity_id,
          jsonb_build_object('issues', v.extraction_issues), btrim(p_reason), 'ravarer');
  return jsonb_build_object('ok', true, 'already', false);
end $$;
revoke execute on function public.rm_confirm_invoice_read_issues(uuid, text) from public, anon;
grant execute on function public.rm_confirm_invoice_read_issues(uuid, text) to authenticated;

-- Slå et læringseksempel av/på.
create or replace function public.rm_set_extraction_example_active(p_example_id uuid, p_active boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); e invoice_extraction_examples%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into e from invoice_extraction_examples where id = p_example_id for update;
  if not found then raise exception 'finnes_ikke' using errcode = 'P0002'; end if;
  if not has_ravarer_invoice_access(e.legal_entity_id, 'write') then raise exception 'forbidden: Mangler skrivetilgang til fakturaer' using errcode = '42501'; end if;
  update invoice_extraction_examples set is_active = p_active,
    deactivated_at = case when p_active then null else now() end,
    deactivated_by = case when p_active then null else v_uid end
  where id = e.id;
  insert into audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, case when p_active then 'extraction_example.activated' else 'extraction_example.deactivated' end,
          'supplier', e.supplier_id, e.legal_entity_id, jsonb_build_object('example_id', e.id), nullif(btrim(coalesce(p_reason,'')), ''), 'ravarer');
  return jsonb_build_object('ok', true, 'is_active', p_active);
end $$;
revoke execute on function public.rm_set_extraction_example_active(uuid, boolean, text) from public, anon;
grant execute on function public.rm_set_extraction_example_active(uuid, boolean, text) to authenticated;

-- Bekreftede eksempler for SAMME selskap og leverandør (brukes av uttrekkeren server-side).
create or replace function public.rm_extraction_examples_for(p_legal_entity_id uuid, p_supplier_id uuid, p_limit int default 20)
returns table (id uuid, supplier_sku_norm text, description_key text, original jsonb, corrected jsonb, note text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not has_ravarer_invoice_access(p_legal_entity_id, 'read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select e.id, e.supplier_sku_norm, e.description_key, e.original, e.corrected, e.note, e.created_at
      from invoice_extraction_examples e
      join suppliers s on s.id = e.supplier_id and s.legal_entity_id = e.legal_entity_id
     where e.legal_entity_id = p_legal_entity_id and e.supplier_id = p_supplier_id and e.is_active
     order by e.created_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;
revoke execute on function public.rm_extraction_examples_for(uuid, uuid, int) from public, anon;
grant execute on function public.rm_extraction_examples_for(uuid, uuid, int) to authenticated, service_role;

-- Lagre en ny kladdversjon for en leverandørsak.
create or replace function public.supplier_case_save_email_draft(p_case_id uuid, p_subject text, p_body text, p_missing_basis boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); c supplier_deviation_cases%rowtype; v_ver int; v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into c from supplier_deviation_cases where id = p_case_id for update;
  if not found then raise exception 'finnes_ikke' using errcode = 'P0002'; end if;
  if not has_ravarer_invoice_access(c.legal_entity_id, 'write') then raise exception 'forbidden: Mangler skrivetilgang til fakturaer' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_subject,''))) = 0 or length(p_subject) > 300 then raise exception 'emne: Emnet må ha 1–300 tegn.' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_body,''))) = 0 or length(p_body) > 20000 then raise exception 'tekst: Teksten må ha 1–20 000 tegn.' using errcode = '22023'; end if;
  select coalesce(max(version), 0) + 1 into v_ver from supplier_case_email_drafts where case_id = c.id;
  insert into supplier_case_email_drafts (case_id, legal_entity_id, version, subject, body, missing_basis, created_by)
  values (c.id, c.legal_entity_id, v_ver, btrim(p_subject), p_body, coalesce(p_missing_basis,false), v_uid)
  returning id into v_id;
  insert into audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, source_app)
  values (v_uid, 'supplier_case.email_draft_saved', 'supplier_deviation_case', c.id, c.title, c.legal_entity_id,
          jsonb_build_object('draft_id', v_id, 'version', v_ver), 'ravarer');
  return jsonb_build_object('ok', true, 'draft_id', v_id, 'version', v_ver);
end $$;
revoke execute on function public.supplier_case_save_email_draft(uuid, text, text, boolean) from public, anon;
grant execute on function public.supplier_case_save_email_draft(uuid, text, text, boolean) to authenticated;

-- Legg kladden i utsendingskøen — KUN til Henrik, mottaker bestemt her. Idempotent per versjon.
create or replace function public.supplier_case_queue_draft_to_henrik(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); d supplier_case_email_drafts%rowtype; c supplier_deviation_cases%rowtype;
  v_sup text; v_out uuid; v_status text;
  c_recipient constant text := 'Henrik@nottero-bakeri.no';
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into d from supplier_case_email_drafts where id = p_draft_id for update;
  if not found then raise exception 'finnes_ikke' using errcode = 'P0002'; end if;
  if not has_ravarer_invoice_access(d.legal_entity_id, 'write') then raise exception 'forbidden: Mangler skrivetilgang til fakturaer' using errcode = '42501'; end if;
  select id, status into v_out, v_status from email_outbox where related_entity_type = 'supplier_case_email_draft' and related_entity_id = d.id;
  if v_out is not null then
    return jsonb_build_object('ok', true, 'already', true, 'outbox_id', v_out, 'status', v_status);
  end if;
  select * into c from supplier_deviation_cases where id = d.case_id;
  select name into v_sup from suppliers where id = c.supplier_id;
  insert into email_outbox (template_key, recipient_email, variables, status, related_entity_type, related_entity_id)
  values ('supplier_case_draft_internal', c_recipient,
          jsonb_build_object('subject', d.subject, 'body', d.body, 'case_title', coalesce(c.title,''),
                             'supplier_name', coalesce(v_sup,''), 'version', d.version::text),
          'pending', 'supplier_case_email_draft', d.id)
  returning id into v_out;
  insert into audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'supplier_case.email_draft_queued', 'supplier_deviation_case', c.id, c.title, c.legal_entity_id,
          jsonb_build_object('draft_id', d.id, 'version', d.version, 'outbox_id', v_out, 'internal_only', true),
          'Intern kladd lagt i kø til Henrik. Ikke sendt til leverandøren.', 'ravarer');
  return jsonb_build_object('ok', true, 'already', false, 'outbox_id', v_out, 'status', 'pending');
end $$;
revoke execute on function public.supplier_case_queue_draft_to_henrik(uuid) from public, anon;
grant execute on function public.supplier_case_queue_draft_to_henrik(uuid) to authenticated;

-- Kladdene med utsendingsstatus (i kø / sendt / feilet), uten rå feiltekst.
create or replace function public.supplier_case_email_drafts_list(p_case_id uuid)
returns table (id uuid, version int, subject text, body text, missing_basis boolean, created_at timestamptz, created_by uuid,
               outbox_status text, queued_at timestamptz, sent_at timestamptz, attempt_count int, failed boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_entity uuid;
begin
  select legal_entity_id into v_entity from supplier_deviation_cases where supplier_deviation_cases.id = p_case_id;
  if v_entity is null then return; end if;
  if not has_ravarer_invoice_access(v_entity, 'read') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select d.id, d.version, d.subject, d.body, d.missing_basis, d.created_at, d.created_by,
           o.status, o.created_at, o.sent_at, o.attempt_count, (o.status = 'failed')
      from supplier_case_email_drafts d
      left join email_outbox o on o.related_entity_type = 'supplier_case_email_draft' and o.related_entity_id = d.id
     where d.case_id = p_case_id
     order by d.version desc
     limit 50;
end $$;
revoke execute on function public.supplier_case_email_drafts_list(uuid) from public, anon;
grant execute on function public.supplier_case_email_drafts_list(uuid) to authenticated;
