-- Regresjon: 20261014_invoice_exclusion_queue_classification.
-- (a) Nyeste utelatte linje for samme leverandør-SKU skal ikke skjule et eldre åpent varekort
--     i verken rm_supplier_items eller rm_work_items.
-- (b) Utelatt dokument med flagged_at skal ikke gi flaggetoppgave eller telle i flaggtellerne.
-- Syntetiske data, versjon i API-format (to_jsonb(updated_at)#>>'{}'), avslutter alltid med RAISE (rollback).
do $$
declare
  le uuid := '751709bc-04b3-4449-867d-b97faa9ab373';
  w uuid; sup uuid; ia uuid; ib uuid; ic uuid; la uuid; lb uuid; v text; r jsonb; it jsonb; log text := '';
  s0 jsonb; s1 jsonb; c0 jsonb; c1 jsonb; ok boolean;
begin
  for w in select id from auth.users order by created_at loop
    perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
    exit when public.has_ravarer_invoice_access(le, 'write');
  end loop;
  s0 := public.rm_work_summary(le, false);
  c0 := public.rm_work_items(le, 'alle', null, null, 'oldest', 1, 0)->'counts';

  perform set_config('request.jwt.claims', '', true);
  insert into suppliers (legal_entity_id, name) values (le, 'TEST køklassifisering') returning id into sup;
  insert into invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, total_amount, total_vat, currency, status, lines_sum_status)
  values (le, sup, 'TEST-Q-A', '2026-08-01', 100, 25, 'NOK', 'needs_review', 'ok') returning id into ia;
  insert into invoice_lines (invoice_id, line_number, description, supplier_sku, quantity, unit, unit_price, total_amount, match_confidence, requires_review)
  values (ia, 1, 'Testvare Q', 'TSTQ1', 1, 'stk', 100, 100, 'unmatched', true) returning id into la;
  insert into invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, total_amount, total_vat, currency, status, lines_sum_status)
  values (le, sup, 'TEST-Q-B', '2026-09-01', 100, 25, 'NOK', 'needs_review', 'ok') returning id into ib;
  insert into invoice_lines (invoice_id, line_number, description, supplier_sku, quantity, unit, unit_price, total_amount, match_confidence, requires_review)
  values (ib, 1, 'Testvare Q', 'TSTQ1', -1, 'stk', 100, -100, 'unmatched', true) returning id into lb;
  insert into invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, total_amount, total_vat, currency, status, lines_sum_status,
                        flagged_at, flag_reason)
  values (le, sup, 'TEST-Q-C', '2026-09-02', 50, 12.5, 'NOK', 'needs_review', 'ok', now(), 'Test flagg') returning id into ic;

  perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
  select to_jsonb(updated_at)#>>'{}' into v from invoices where id = ib;
  r := public.rm_set_invoice_exclusion(ib, 'invoice', null, 'erstatning_produksjonstap', 'Erstatning, nyeste samme SKU', v, gen_random_uuid());
  log := log || format('%s utelat_nyeste=%s; ', case when (r->>'ok')::boolean then 'ok' else 'FEIL' end, r->>'error');
  select to_jsonb(updated_at)#>>'{}' into v from invoices where id = ic;
  log := log || format('%s api_format; ', case when v like '%T%+00:00' then 'ok' else 'FEIL' end);
  r := public.rm_set_invoice_exclusion(ic, 'invoice', null, 'annet', 'Flagget dokument holdes utenfor', v, gen_random_uuid());
  log := log || format('%s utelat_flagget=%s; ', case when (r->>'ok')::boolean then 'ok' else 'FEIL' end, r->>'error');

  -- (a) rm_supplier_items: eldre åpen linje bestemmer kortet.
  select x into it from jsonb_array_elements(public.rm_supplier_items(le, sup, null, null, 50, 0)->'items') x where x->>'item_key' = 'sku:TSTQ1';
  log := log || format('%s varekort_eldre_apen last_invoice=%s open=%s; ',
    case when it->>'last_invoice_id' = ia::text and (it->>'open_lines')::int = 1 then 'ok' else 'FEIL' end, it->>'last_invoice_id', it->>'open_lines');
  -- (a) rm_work_items: kortet finnes fortsatt i arbeidskøen.
  ok := exists (select 1 from jsonb_array_elements(public.rm_work_items(le, 'alle', null, sup, 'oldest', 50, 0)->'items') x
                where x->>'item_key' = 'sku:TSTQ1' and x->>'type' = 'varekort');
  log := log || format('%s arbeidsko_eldre_apen; ', case when ok then 'ok' else 'FEIL' end);
  -- (b) Flagget utelatt dokument: ingen oppgave og ingen flaggteller.
  ok := position(ic::text in public.rm_work_items(le, 'alle', null, sup, 'oldest', 50, 0)::text) = 0;
  log := log || format('%s flagget_ikke_i_ko; ', case when ok then 'ok' else 'FEIL' end);
  s1 := public.rm_work_summary(le, false);
  c1 := public.rm_work_items(le, 'alle', null, null, 'oldest', 1, 0)->'counts';
  log := log || format('%s summary_flagged %s->%s; ', case when s1->'invoices'->>'flagged' = s0->'invoices'->>'flagged' then 'ok' else 'FEIL' end,
    s0->'invoices'->>'flagged', s1->'invoices'->>'flagged');
  log := log || format('%s faktura_flagget %s->%s; ', case when c1->>'faktura_flagget' = c0->>'faktura_flagget' then 'ok' else 'FEIL' end,
    c0->>'faktura_flagget', c1->>'faktura_flagget');

  raise exception 'RESULTAT: %', log;
end $$;
