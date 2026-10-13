CREATE OR REPLACE FUNCTION public.rm_price_reference(p_raw_material_id uuid, p_supplier_id uuid, p_invoice_id uuid DEFAULT NULL::uuid, p_invoice_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_first  record;
  v_second record;
  v_hist   record;
  v_start  record;
  v_entity uuid;
  v_inv    record;
  v_cutoff date;
  v_cutoff_ts timestamptz;
  v_base_unit text;
begin
  if p_raw_material_id is null or p_supplier_id is null or p_invoice_date is null then
    return jsonb_build_object('source', 'none', 'reason', 'mangler_vare_leverandor_eller_dato');
  end if;

  select rm.legal_entity_id, rm.base_unit into v_entity, v_base_unit
    from public.raw_materials rm
   where rm.id = p_raw_material_id;
  if v_entity is null then
    raise exception 'Råvaren finnes ikke';
  end if;

  if p_invoice_id is not null then
    select i.legal_entity_id, i.supplier_id into v_inv
      from public.invoices i
     where i.id = p_invoice_id;
    if not found then
      raise exception 'Fakturaen finnes ikke';
    end if;
    if v_inv.legal_entity_id is distinct from v_entity then
      raise exception 'Faktura og råvare tilhører ulike selskap';
    end if;
    if v_inv.supplier_id is distinct from p_supplier_id then
      raise exception 'Leverandøren stemmer ikke med fakturaen';
    end if;
  end if;

  if auth.uid() is not null and not public.has_ravarer_invoice_access(v_entity, 'read') then
    raise exception 'Ingen fakturatilgang for dette selskapet';
  end if;

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
    select s.id
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

  select s.id, s.start_price_per_base_unit as price, s.start_price_effective_date as eff,
         s.start_price_invoice_id as invoice_id
    into v_start
    from public.raw_material_suppliers s
   where s.raw_material_id = p_raw_material_id
     and s.supplier_id     = p_supplier_id
     and s.start_price_per_base_unit is not null
     and public.rm_is_finite(s.start_price_per_base_unit)
     and s.start_price_per_base_unit > 0
     and s.start_price_effective_date is not null
     and s.start_price_effective_date <= p_invoice_date
     and upper(coalesce(s.start_price_currency, 'NOK')) = 'NOK'
     and s.start_price_base_unit is not distinct from v_base_unit
     and s.start_price_base_units_per_package is not distinct from s.base_units_per_package
     and s.start_price_package_size is not distinct from s.package_size
     and s.start_price_package_unit is not distinct from s.package_unit
     and s.start_price_unit_change_at is not distinct from public.rm_unit_change_at(p_raw_material_id)
   limit 1;

  if found then
    return jsonb_build_object(
      'source', 'start_price',
      'price', v_start.price,
      'reference_id', v_start.id,
      'reference_date', v_start.eff,
      'invoice_id', v_start.invoice_id);
  end if;

  v_cutoff := public.rm_unit_change_cutoff(p_raw_material_id);
  v_cutoff_ts := public.rm_unit_change_at(p_raw_material_id);

  -- Forrige kjøp: bare gyldige, dokumenterte observasjoner (samme regler som
  -- kostprisvelgeren) fra samme leverandør, strengt FØR fakturadatoen og aldri
  -- fra fakturaen selv. Behandlingsrekkefølge påvirker ikke valget.
  select h.history_id as id, h.price, h.effective_date, h.invoice_id
    into v_hist
    from public._rm_cost_candidates(p_raw_material_id, p_invoice_date - 1) h
   where h.source = 'invoice'
     and h.supplier_id = p_supplier_id
     and h.effective_date < p_invoice_date
     and h.effective_date >= coalesce(v_cutoff, '-infinity'::date)
     and (v_cutoff_ts is null or h.created_at >= v_cutoff_ts)
     and (p_invoice_id is null or h.invoice_id is distinct from p_invoice_id)
   order by h.effective_date desc, h.created_at desc, h.history_id desc
   limit 1;

  if found then
    -- Flere kjøp samme dato med ulik pris: ingen stille valg.
    if exists (
      select 1 from public._rm_cost_candidates(p_raw_material_id, v_hist.effective_date) h2
       where h2.source = 'invoice'
         and h2.supplier_id = p_supplier_id
         and h2.effective_date = v_hist.effective_date
         and (v_cutoff_ts is null or h2.created_at >= v_cutoff_ts)
         and (p_invoice_id is null or h2.invoice_id is distinct from p_invoice_id)
         and round(h2.price, 4) <> round(v_hist.price, 4)) then
      return jsonb_build_object(
        'source', 'conflict',
        'reason', 'flere_kjop_samme_dato_ulik_pris',
        'reference_date', v_hist.effective_date);
    end if;
    return jsonb_build_object(
      'source', 'last_purchase',
      'price', v_hist.price,
      'reference_id', v_hist.id,
      'reference_date', v_hist.effective_date,
      'invoice_id', v_hist.invoice_id);
  end if;

  if v_cutoff is not null then
    return jsonb_build_object('source', 'none', 'reason', 'ingen_sammenlignbare_kjop_etter_enhetsendring');
  end if;

  return jsonb_build_object('source', 'none', 'reason', 'ingen_avtale_eller_tidligere_kjop');
end;
$function$;

DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public._rm_cost_candidates(uuid,date)'::regprocedure);
  n := replace(d, 'order by h.effective_date desc, h.created_at desc, h.id desc',
                  'order by h.effective_date desc, h.price desc, h.created_at desc, h.id desc');
  IF n = d THEN RAISE EXCEPTION 'cost_candidates: ordning ikke funnet'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.rm_work_items(uuid,text,text,uuid,text,integer,integer)'::regprocedure);
  n := d;
  n := replace(n, 'count(distinct invoice_id) invoice_count, max(invoice_date) last_seen,',
                  'count(distinct invoice_id) invoice_count, max(invoice_date) last_seen, min(invoice_date) filter (where requires_review and is_open) oldest_open,');
  n := replace(n, 'c.last_seen as last_date, c.last_open_line_id,',
                  'c.last_seen as last_date, c.oldest_open as first_open_date, c.last_open_line_id,');
  n := replace(n, 'x.invoice_date as last_date, null::uuid as last_open_line_id,',
                  'x.invoice_date as last_date, x.invoice_date as first_open_date, null::uuid as last_open_line_id,');
  n := replace(n, 's.last_date desc nulls last, s.key) rn',
                  'case when p_sort = ''oldest'' then s.first_open_date end asc nulls last,
             s.last_date desc nulls last, s.key) rn');
  IF (length(n) - length(d)) < 200 OR position('oldest_open as first_open_date' in n) = 0
     OR position('x.invoice_date as first_open_date' in n) = 0 OR position('p_sort = ''oldest''' in n) = 0 THEN
    RAISE EXCEPTION 'rm_work_items: endringspunkter ikke funnet';
  END IF;
  EXECUTE n;
END $do$;

CREATE OR REPLACE FUNCTION public._rm_retain_price_acceptance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  acc jsonb := OLD.price_acceptance;
  v_allowed constant text[] := ARRAY['price_variance','price_increase','price_drop'];
  v_inv invoices%rowtype;
  v_old_basis jsonb; v_new_basis jsonb; v_new_full jsonb;
  v_accepted text[]; v_reasons text[]; v_rest text[];
  ref_keys constant text[] := ARRAY['expected_price_per_base_unit','price_reference_source','price_reference_id','price_reference_date'];
BEGIN
  IF acc IS NULL OR NEW.price_acceptance IS NOT NULL OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN RETURN NEW; END IF;
  -- Bare når både godtatt og nytt grunnlag er «forrige kjøp», og det nye kjøpet er
  -- like nytt eller nyere enn det som ble godtatt (men fortsatt før fakturadatoen).
  IF coalesce(acc->>'price_reference_source','') <> 'last_purchase'
     OR coalesce(NEW.price_reference_source,'') <> 'last_purchase'
     OR NEW.price_reference_date IS NULL OR nullif(acc->>'price_reference_date','') IS NULL
     OR NEW.price_reference_date < (acc->>'price_reference_date')::date THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_inv FROM invoices WHERE id = NEW.invoice_id;
  IF NOT FOUND OR v_inv.invoice_date IS NULL OR NEW.price_reference_date >= v_inv.invoice_date
     OR coalesce(v_inv.is_credit_note,false) OR upper(coalesce(v_inv.currency,'NOK')) <> 'NOK'
     OR v_inv.status IS NULL OR v_inv.status NOT IN ('imported','needs_review','ready') THEN
    RETURN NEW;
  END IF;
  -- Linjens eget grunnlag (vare, mengde, enhet, pris, sum, pakning) må være identisk.
  v_new_full := public.invoice_line_price_basis(NEW);
  v_old_basis := public._normalize_price_basis(acc) - ref_keys;
  v_new_basis := public._normalize_price_basis(v_new_full) - ref_keys;
  IF v_old_basis IS DISTINCT FROM v_new_basis
     OR (acc->>'rms_id') IS DISTINCT FROM (v_new_full->>'rms_id')
     OR (acc->'rms_package') IS DISTINCT FROM (v_new_full->'rms_package') THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(array_agg(r), '{}') INTO v_accepted
    FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(acc->'accepted_reasons')='array' THEN acc->'accepted_reasons' ELSE '[]'::jsonb END) r
   WHERE r = ANY(v_allowed);
  SELECT coalesce(array_agg(btrim(r)), '{}') INTO v_reasons
    FROM unnest(string_to_array(coalesce(NEW.review_reason,''), ',')) r WHERE btrim(r) <> '';
  SELECT coalesce(array_agg(r), '{}') INTO v_rest FROM unnest(v_reasons) r WHERE NOT (r = ANY(v_accepted));

  NEW.price_acceptance := acc;
  NEW.review_reason := nullif(array_to_string(v_rest, ','), '');
  IF cardinality(v_reasons) > 0 AND cardinality(v_rest) = 0 THEN NEW.requires_review := false;
  ELSIF cardinality(v_rest) > 0 THEN NEW.requires_review := true; END IF;
  NEW.resolution_note := OLD.resolution_note;
  NEW.resolved_by := OLD.resolved_by;
  NEW.resolved_at := OLD.resolved_at;

  INSERT INTO audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  VALUES (auth.uid(), 'invoice_line.price_acceptance_retained', 'invoice_line', NEW.id, v_inv.legal_entity_id,
          jsonb_build_object('accepted_reference_id', acc->>'price_reference_id', 'accepted_reference_date', acc->>'price_reference_date',
                             'new_reference_id', NEW.price_reference_id, 'new_reference_date', NEW.price_reference_date,
                             'new_expected_price_per_base_unit', NEW.expected_price_per_base_unit,
                             'remaining_reasons', to_jsonb(v_rest)),
          'Godtatt prisavvik beholdt: linjen er uendret, bare forrige kjøp er flyttet', 'ravarer');
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public._rm_retain_price_acceptance() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER zz_rm_retain_price_acceptance
  BEFORE UPDATE ON public.invoice_lines
  FOR EACH ROW
  WHEN (OLD.price_acceptance IS NOT NULL AND NEW.price_acceptance IS NULL)
  EXECUTE FUNCTION public._rm_retain_price_acceptance();