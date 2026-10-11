-- Isolert regresjonstest for rm_save_manual_pdf_invoice. Alt rulles tilbake (RAISE til slutt).
-- Kjør som én blokk. Endrer ingen reelle data.
DO $t$
DECLARE
  le uuid := '751709bc-04b3-4449-867d-b97faa9ab373';
  uid uuid := 'b4074a41-395b-470e-bac9-1cad293bc714';
  res jsonb; res2 jsonb; inv uuid; sup uuid; n int; st text; ev jsonb; iss jsonb; before_inv int; before_sup int;
  path text := le::text || '/zz_test_atomic.pdf';
  rows_ok jsonb := '[{"description":"ZZ Mel","quantity":2,"unit":"stk","unit_price":10,"total_amount":20,
     "read_issues":[],"evidence":{"confidence":0.95,"number_evidence":[{"field":"quantity","raw":"2","value":2}]}}]';
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO before_inv FROM invoices WHERE legal_entity_id = le;
  SELECT count(*) INTO before_sup FROM suppliers WHERE legal_entity_id = le;

  -- 1) Ny leverandør + faktura + linje i én operasjon, bevis lagret, høy sikkerhet => imported.
  res := rm_save_manual_pdf_invoice(le, '{"name":"ZZ Testleverandør atomisk"}',
    jsonb_build_object('invoice_number','ZZ-1','invoice_date','2026-10-01','source_document_url',path,
      'extraction_confidence',0.95,'lines_sum_status','ok','total_amount',25,'total_vat',5), rows_ok);
  ASSERT (res->>'ok')::boolean AND (res->>'supplier_created')::boolean, 'T1 ok: ' || res::text;
  inv := (res->>'invoice_id')::uuid; sup := (res->>'supplier_id')::uuid;
  SELECT extraction_evidence, extraction_issues INTO ev, iss FROM invoice_lines WHERE invoice_id = inv;
  ASSERT ev->>'source' = 'manual_pdf' AND jsonb_array_length(ev->'number_evidence') = 1 AND (ev->>'confidence')::numeric = 0.95, 'T1 evidence';
  ASSERT res->>'status' = 'imported', 'T1 status ' || res::text;

  -- 2) Nytt forsøk med samme dokument gir samme faktura, ingen ny rad.
  res2 := rm_save_manual_pdf_invoice(le, jsonb_build_object('id', sup),
    jsonb_build_object('invoice_number','ZZ-1','invoice_date','2026-10-01','source_document_url',path,'extraction_confidence',0.95), rows_ok);
  ASSERT (res2->>'replayed')::boolean AND (res2->>'invoice_id')::uuid = inv, 'T2 replay ' || res2::text;
  SELECT count(*) INTO n FROM invoice_lines WHERE invoice_id = inv; ASSERT n = 1, 'T2 lines';

  -- 3) Samme fakturanr fra annet dokument => duplikat, ingen skriving.
  res2 := rm_save_manual_pdf_invoice(le, jsonb_build_object('id', sup),
    jsonb_build_object('invoice_number','ZZ-1','invoice_date','2026-10-01','source_document_url',le::text||'/annen.pdf'), rows_ok);
  ASSERT res2->>'code' = 'duplikat', 'T3 dup';

  -- 4) Manglende sikkerhet => needs_review. Leserens varsel bevares.
  res2 := rm_save_manual_pdf_invoice(le, jsonb_build_object('id', sup),
    jsonb_build_object('invoice_number','ZZ-2','invoice_date','2026-10-01','source_document_url',le::text||'/zz2.pdf'),
    '[{"description":"ZZ","quantity":1,"unit":"stk","unit_price":5,"total_amount":5,"read_issues":[{"code":"tvetydig_tall","message":"x"}],"evidence":{"confidence":null}}]');
  ASSERT res2->>'status' = 'needs_review', 'T4 status';
  SELECT extraction_issues INTO iss FROM invoice_lines WHERE invoice_id = (res2->>'invoice_id')::uuid;
  ASSERT iss @> '[{"code":"tvetydig_tall"}]', 'T4 issue kept ' || iss::text;

  -- 5) Ugyldig sikkerhet (100 = rå 100 %) behandles som ukjent => needs_review.
  res2 := rm_save_manual_pdf_invoice(le, jsonb_build_object('id', sup),
    jsonb_build_object('invoice_number','ZZ-3','invoice_date','2026-10-01','source_document_url',le::text||'/zz3.pdf','extraction_confidence',100), rows_ok);
  SELECT extraction_confidence, status INTO ev, st FROM (SELECT to_jsonb(extraction_confidence) extraction_confidence, status FROM invoices WHERE id=(res2->>'invoice_id')::uuid) q;
  ASSERT st = 'needs_review' AND ev = 'null'::jsonb, 'T5 invalid confidence';

  -- 6) Feil midt i linjene => hele lagringen rulles tilbake (ingen leverandør/faktura igjen).
  BEGIN
    PERFORM rm_save_manual_pdf_invoice(le, '{"name":"ZZ Rollback leverandør"}',
      jsonb_build_object('invoice_number','ZZ-4','invoice_date','2026-10-01','source_document_url',le::text||'/zz4.pdf','extraction_confidence',0.9),
      '[{"description":"ok","quantity":1,"total_amount":1},{"description":"feil","line_kind":"ugyldig_type"}]');
    RAISE EXCEPTION 'T6 forventet feil';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM suppliers WHERE legal_entity_id=le AND name='ZZ Rollback leverandør'), 'T6 supplier rolled back';
  ASSERT NOT EXISTS (SELECT 1 FROM invoices WHERE legal_entity_id=le AND invoice_number='ZZ-4'), 'T6 invoice rolled back';

  -- 7) Annet selskaps dokumentsti avvises.
  res2 := rm_save_manual_pdf_invoice(le, jsonb_build_object('id', sup),
    jsonb_build_object('invoice_number','ZZ-5','invoice_date','2026-10-01','source_document_url','00000000-0000-0000-0000-000000000000/x.pdf'), rows_ok);
  ASSERT res2->>'code' = 'ugyldig_dokument', 'T7 path';

  -- 8) Uten tilgang til selskapet => avvist.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM rm_save_manual_pdf_invoice(le, jsonb_build_object('id', sup), jsonb_build_object('invoice_number','ZZ-6','invoice_date','2026-10-01','source_document_url',path), rows_ok);
    RAISE EXCEPTION 'T8 forventet tilgangsfeil';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RAISE EXCEPTION 'ALLE_TESTER_OK (rollback)';
END $t$;
