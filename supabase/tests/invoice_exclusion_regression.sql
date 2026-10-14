-- Regresjon: «Hold utenfor råvarebehandling» (rm_set_invoice_exclusion / rm_reopen_invoice_exclusion).
-- Kjøres som én DO-blokk som ALLTID avslutter med RAISE, slik at alt rulles tilbake. Resultatet står i feilmeldingen
-- («RESULTAT: ...»). Ingen ekte fakturaer berøres; alle data er syntetiske og lages i blokken.
do $$
declare
  le uuid := '751709bc-04b3-4449-867d-b97faa9ab373';
  w uuid; ro uuid; rm uuid; sup uuid; inv uuid; inv2 uuid; l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid;
  r jsonb; op uuid := gen_random_uuid(); op2 uuid := gen_random_uuid(); v text; n int; log text := '';
  s_before jsonb; s_after jsonb; ok boolean;
  procedure_claims text;
begin
  -- Bruker med skriverett og bruker uten (lesetilgang/ingen).
  for w in select id from auth.users order by created_at loop
    perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
    exit when public.has_ravarer_invoice_access(le, 'write');
  end loop;
  for ro in select id from auth.users order by created_at loop
    perform set_config('request.jwt.claims', json_build_object('sub', ro, 'role', 'authenticated')::text, true);
    exit when not public.has_ravarer_invoice_access(le, 'write');
  end loop;
  perform set_config('request.jwt.claims', '', true);
  select id into rm from raw_materials where legal_entity_id = le and not coalesce(stock_tracking, false) limit 1;
  insert into suppliers (legal_entity_id, name) values (le, 'TEST utelatelse leverandør') returning id into sup;
  insert into invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, total_amount, total_vat, currency, status,
                        is_credit_note, lines_sum_status)
  values (le, sup, 'TEST-EXCL-1', '2026-09-01', -1000, -250, 'NOK', 'needs_review', true, 'mismatch') returning id into inv;
  insert into invoice_lines (invoice_id, line_number, description, quantity, unit, unit_price, total_amount, raw_material_id, match_confidence, requires_review, review_reason)
  values (inv, 1, 'Combisur erstatning', -1, 'stk', 500, -500, rm, 'manual', true, 'price_variance') returning id into l1;
  insert into invoice_lines (invoice_id, line_number, description, quantity, unit, unit_price, total_amount, match_confidence, requires_review)
  values (inv, 2, 'Produksjonstap', -1, 'stk', 300, -300, 'unmatched', true) returning id into l2;
  insert into invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, total_amount, total_vat, currency, status, lines_sum_status)
  values (le, sup, 'TEST-EXCL-2', '2026-09-02', 1000, 250, 'NOK', 'needs_review', 'ok') returning id into inv2;
  insert into invoice_lines (invoice_id, line_number, description, quantity, unit, unit_price, total_amount, raw_material_id, match_confidence, requires_review, review_reason)
  values (inv2, 1, 'Vare A', 1, 'stk', 600, 600, rm, 'manual', true, 'price_variance') returning id into l3;
  insert into invoice_lines (invoice_id, line_number, description, quantity, unit, unit_price, total_amount, match_confidence, requires_review)
  values (inv2, 2, 'Vare B', 1, 'stk', 400, 400, 'unmatched', true) returning id into l4;
  log := log || format('fixture w=%s ro=%s rm=%s; ', w is not null, ro is not null, rm is not null);

  -- 1) Leserettighet: avvises.
  perform set_config('request.jwt.claims', json_build_object('sub', ro, 'role', 'authenticated')::text, true);
  begin
    select updated_at::text into v from invoices where id = inv;
    r := public.rm_set_invoice_exclusion(inv, 'invoice', null, 'erstatning_produksjonstap', 'Erstatning ødelagte varer', v, op);
    log := log || 'FEIL readonly_tillatt; ';
  exception when sqlstate '42501' then log := log || 'ok readonly_avvist; ';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
  s_before := public.rm_work_summary(le, false);

  -- 2) Versjon og validering.
  r := public.rm_set_invoice_exclusion(inv, 'invoice', null, 'erstatning_produksjonstap', 'Erstatning ødelagte varer', '2000-01-01 00:00:00+00', op);
  log := log || format('%s versjon=%s; ', case when r->>'error' = 'versjon_endret' then 'ok' else 'FEIL' end, r->>'error');
  select updated_at::text into v from invoices where id = inv;
  r := public.rm_set_invoice_exclusion(inv, 'invoice', null, 'erstatning_produksjonstap', 'kort', v, op);
  log := log || format('%s kort_begrunnelse=%s; ', case when r->>'error' = 'begrunnelse_mangler' then 'ok' else 'FEIL' end, r->>'error');

  -- 3) Hele dokumentet.
  r := public.rm_set_invoice_exclusion(inv, 'invoice', null, 'erstatning_produksjonstap', 'Erstatning ødelagte varer etter produksjonsfeil', v, op);
  log := log || format('%s dok_utelatt=%s; ', case when (r->>'ok')::boolean and (r->>'lines')::int = 2 then 'ok' else 'FEIL' end, r);
  select count(*) into n from invoice_lines where invoice_id = inv and excluded_at is not null and raw_material_id is null
     and match_confidence = 'not_applicable' and not requires_review;
  log := log || format('%s linjer_utelatt=%s; ', case when n = 2 then 'ok' else 'FEIL' end, n);
  select count(*) into n from invoice_lines where id = l1 and excluded_raw_material_id = rm;
  log := log || format('%s historisk_kobling=%s; ', case when n = 1 then 'ok' else 'FEIL' end, n);
  select count(*) into n from invoices where id = inv and status = 'excluded' and total_amount = -1000 and lines_sum_status = 'mismatch' and reconciled_at is null;
  log := log || format('%s original_belop_sumstatus_bevart=%s; ', case when n = 1 then 'ok' else 'FEIL' end, n);
  select count(*) into n from audit_log where entity_id = inv and action = 'invoice.excluded' and user_id = w;
  log := log || format('%s audit=%s; ', case when n = 1 then 'ok' else 'FEIL' end, n);

  -- 4) Idempotens: samme op = already, ny op = avvist.
  r := public.rm_set_invoice_exclusion(inv, 'invoice', null, 'erstatning_produksjonstap', 'Erstatning ødelagte varer etter produksjonsfeil', v, op);
  log := log || format('%s gjentak=%s; ', case when (r->>'already')::boolean then 'ok' else 'FEIL' end, r->>'already');
  r := public.rm_set_invoice_exclusion(inv, 'invoice', null, 'annet', 'En annen begrunnelse her', v, op2);
  log := log || format('%s ny_op=%s; ', case when r->>'error' = 'allerede_holdt_utenfor' then 'ok' else 'FEIL' end, r->>'error');

  -- 5) Køer/tellere.
  s_after := public.rm_work_summary(le, false);
  log := log || format('%s open_total %s->%s; ', case when (s_after->'invoices'->>'open_total')::int = (s_before->'invoices'->>'open_total')::int - 1 then 'ok' else 'SJEKK' end,
                       s_before->'invoices'->>'open_total', s_after->'invoices'->>'open_total');
  ok := position(inv::text in coalesce(public.rm_work_items(le, 'alle', null, null, 'oldest', 500, 0)::text, '')) = 0;
  log := log || format('%s ikke_i_arbeidsko; ', case when ok then 'ok' else 'FEIL' end);
  ok := 'holdt_utenfor' = any(public.invoice_approval_blockers(inv));
  log := log || format('%s godkjenning_sperret; ', case when ok then 'ok' else 'FEIL' end);
  select count(*) into n from raw_material_price_history where invoice_id = inv and superseded_at is null;
  log := log || format('%s ingen_aktiv_prisobs=%s; ', case when n = 0 then 'ok' else 'FEIL' end, n);
  select count(*) into n from stock_movements where source_table = 'invoice_lines' and source_id in (l1, l2);
  log := log || format('%s ingen_lager=%s; ', case when n = 0 then 'ok' else 'FEIL' end, n);

  -- 6) Brukerskriving forbi RPC avvises; tjenestekall (rematch/import) beholder utelatt tilstand.
  begin
    update invoices set status = 'needs_review' where id = inv;
    log := log || 'FEIL bruker_status_endret; ';
  exception when sqlstate 'P0001' then log := log || 'ok bruker_status_avvist; ';
  end;
  begin
    update invoice_lines set raw_material_id = rm, match_confidence = 'manual' where id = l1;
    log := log || 'FEIL bruker_kobling_endret; ';
  exception when sqlstate 'P0001' then log := log || 'ok bruker_kobling_avvist; ';
  end;
  perform set_config('request.jwt.claims', '', true);
  update invoices set status = 'needs_review', updated_at = now() where id = inv;
  update invoice_lines set raw_material_id = rm, match_confidence = 'auto_high', requires_review = true, review_reason = 'price_variance' where id = l1;
  insert into invoice_lines (invoice_id, line_number, description, quantity, unit, unit_price, total_amount, raw_material_id, match_confidence, requires_review)
  values (inv, 3, 'Gjenimportert linje', -1, 'stk', 200, -200, rm, 'auto_high', true) returning id into l5;
  select count(*) into n from invoices where id = inv and status = 'excluded';
  log := log || format('%s rematch_status_bevart=%s; ', case when n = 1 then 'ok' else 'FEIL' end, n);
  select count(*) into n from invoice_lines where id in (l1, l5) and raw_material_id is null and match_confidence = 'not_applicable' and excluded_at is not null and not requires_review;
  log := log || format('%s rematch_reimport_utelatt=%s; ', case when n = 2 then 'ok' else 'FEIL' end, n);
  begin
    delete from invoice_lines where id = l2;
    log := log || 'FEIL slett_tillatt; ';
  exception when sqlstate 'P0001' then log := log || 'ok slett_avvist; ';
  end;

  -- 7) Gjenåpne dokumentet: ny kontroll, ingen kobling/godkjenning/lager.
  perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
  select updated_at::text into v from invoices where id = inv;
  r := public.rm_reopen_invoice_exclusion(inv, 'invoice', null, v, 'Test gjenåpning');
  select count(*) into n from invoices where id = inv and status = 'needs_review' and excluded_at is null and reconciled_at is null;
  log := log || format('%s gjenapnet=%s %s; ', case when n = 1 then 'ok' else 'FEIL' end, n, r->>'lines');
  select count(*) into n from invoice_lines where invoice_id = inv and excluded_at is null and requires_review and raw_material_id is null and match_confidence = 'unmatched';
  log := log || format('%s linjer_ny_kontroll=%s; ', case when n = 3 then 'ok' else 'FEIL' end, n);
  select count(*) into n from audit_log where entity_id = inv and action = 'invoice.exclusion_reopened';
  log := log || format('%s audit_gjenapne=%s; ', case when n = 1 then 'ok' else 'FEIL' end, n);

  -- 8) Enkeltlinje: andre linjer behandles normalt.
  select updated_at::text into v from invoice_lines where id = l3;
  r := public.rm_set_invoice_exclusion(inv2, 'line', l3, 'annet', 'Erstatningslinje, ikke råvarepris', v, op2);
  select count(*) into n from invoice_lines where id = l3 and excluded_at is not null and excluded_raw_material_id = rm;
  log := log || format('%s linje_utelatt=%s; ', case when n = 1 and (r->>'ok')::boolean then 'ok' else 'FEIL' end, r);
  select count(*) into n from invoice_lines where id = l4 and excluded_at is null and requires_review;
  log := log || format('%s annen_linje_uendret=%s; ', case when n = 1 then 'ok' else 'FEIL' end, n);
  select count(*) into n from invoices where id = inv2 and status = 'needs_review';
  log := log || format('%s faktura_fortsatt_apen=%s; ', case when n = 1 then 'ok' else 'FEIL' end, n);
  select updated_at::text into v from invoice_lines where id = l3;
  r := public.rm_reopen_invoice_exclusion(inv2, 'line', l3, v, null);
  select count(*) into n from invoice_lines where id = l3 and excluded_at is null and requires_review and review_reason = 'reopened_exclusion';
  log := log || format('%s linje_gjenapnet=%s; ', case when n = 1 then 'ok' else 'FEIL' end, n);

  -- 9) Ført kostpris sperrer (linje og hele dokumentet).
  insert into invoice_line_cost_postings (invoice_line_id, invoice_id, legal_entity_id, first_cost, posted_by, posted_at)
  values (l4, inv2, le, false, w, now());
  select updated_at::text into v from invoice_lines where id = l4;
  r := public.rm_set_invoice_exclusion(inv2, 'line', l4, 'annet', 'Skal sperres av kostføring', v, gen_random_uuid());
  log := log || format('%s kost_sperrer_linje=%s; ', case when r->>'error' = 'reversering_kreves' then 'ok' else 'FEIL' end, r->>'error');
  select updated_at::text into v from invoices where id = inv2;
  r := public.rm_set_invoice_exclusion(inv2, 'invoice', null, 'annet', 'Skal sperres av kostføring', v, gen_random_uuid());
  log := log || format('%s kost_sperrer_dok=%s; ', case when r->>'error' = 'reversering_kreves' and jsonb_array_length(r->'blocked_lines') = 1 then 'ok' else 'FEIL' end, r);
  select count(*) into n from invoice_lines where invoice_id = inv2 and excluded_at is not null;
  log := log || format('%s ingenting_endret=%s; ', case when n = 0 then 'ok' else 'FEIL' end, n);

  raise exception 'RESULTAT: %', log;
end $$;
