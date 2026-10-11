-- Atomisk krav/ferdigstilling av Tripletex-linjeuthenting. Oppdiktet leverandør/faktura; rulles alltid tilbake via exception.
-- Forventet (2026-10-11, live): claim2=0, stale=utdatert_kjoring, ok lines=1 needs_review med leser-varsler,
-- retry=utdatert_kjoring, claim_after_done=0, manuell linje under lesing => har_linjer og manuell linje beholdt, dup=unik ok.
do $$
declare le uuid := '751709bc-04b3-4449-867d-b97faa9ab373'; sup uuid; inv uuid; t1 uuid; t2 uuid; c2 int; f1 jsonb; f2 jsonb; f3 jsonb; f4 jsonb; c3 int;
  rows jsonb := '[{"line_number":1,"description":"Mandler","quantity":10,"unit":"kg","unit_price":110,"total_amount":1100,"unit_price_basis":"mengdeenhet","line_kind":"vare","read_issues":[{"code":"tvetydig_tall","message":"Tvetydig tall i mengde"}],"evidence":{"confidence":null,"number_evidence":[{"field":"quantity","raw":"10.000"}]}}]';
begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  insert into suppliers(legal_entity_id, name) values (le, 'TEST-LEV-ROLLBACK') returning id into sup;
  insert into invoices(legal_entity_id, supplier_id, invoice_number, invoice_date, total_amount, total_vat, status, tripletex_supplier_invoice_id, line_extraction_status)
  values (le,sup,'TEST-CLAIM','2026-10-01',1375,275,'imported','TEST-TT-1','pending') returning id into inv;
  select claim_token into t1 from rm_claim_invoice_line_extraction(le,1,inv);
  select count(*) into c2 from rm_claim_invoice_line_extraction(le,1,inv);
  f1 := rm_finalize_invoice_line_extraction(inv, gen_random_uuid(), rows, '{}');
  f2 := rm_finalize_invoice_line_extraction(inv, t1, rows, '{"extraction_confidence":0.99}');
  f3 := rm_finalize_invoice_line_extraction(inv, t1, rows, '{}');
  update invoices set line_extraction_status='pending', line_extraction_token=null, line_extraction_at=null where id=inv;
  select count(*) into c3 from rm_claim_invoice_line_extraction(le,1,inv);
  delete from invoice_lines where invoice_id=inv;
  select claim_token into t2 from rm_claim_invoice_line_extraction(le,1,inv);
  insert into invoice_lines(invoice_id,line_number,description,total_amount) values (inv,1,'Manuell',1100);
  f4 := rm_finalize_invoice_line_extraction(inv, t2, rows, '{}');
  if c2<>0 or f1->>'code'<>'utdatert_kjoring' or (f2->>'ok')::boolean is not true or f3->>'code'<>'utdatert_kjoring' or c3<>0 or f4->>'code'<>'har_linjer'
  then raise exception 'FEIL % % % % % %', c2, f1, f2, f3, c3, f4; end if;
  raise exception 'OK (rollback)';
end $$;
