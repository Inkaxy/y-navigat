-- Isolert: alt rulles tilbake via avsluttende exception. Ingen reelle fakturaer endres.
do $$
declare le uuid := '751709bc-04b3-4449-867d-b97faa9ab373'; sup uuid; inv uuid; inv2 uuid; r text := '';
begin
  insert into suppliers(legal_entity_id,name) values (le,'ZZ replay test') returning id into sup;
  -- 1) Commit uten matching (svar tapt før matching): replay fortsetter én gang.
  insert into invoices(legal_entity_id,supplier_id,invoice_number,invoice_date,source,source_document_url,status)
    values (le,sup,'ZZ-R1',current_date,'pdf_upload',le||'/zz1.pdf','imported') returning id into inv;
  insert into invoice_lines(invoice_id,line_number,description,quantity,unit_price,total_amount) values (inv,1,'Mel',1,10,10);
  r := r || 'replay1=' || public._rm_manual_pdf_enqueue_match(inv,true);
  r := r || ' replay2=' || public._rm_manual_pdf_enqueue_match(inv,true);
  r := r || ' queued=' || (select count(*) from rm_rematch_queue where invoice_id=inv);
  -- 2) Avstemt faktura: aldri ny matching ved replay.
  insert into invoices(legal_entity_id,supplier_id,invoice_number,invoice_date,source,source_document_url,status)
    values (le,sup,'ZZ-R2',current_date,'pdf_upload',le||'/zz2.pdf','needs_review') returning id into inv2;
  update invoices set reconciled_at=now() where id=inv2;
  insert into invoice_lines(invoice_id,line_number,description,quantity,unit_price,total_amount) values (inv2,1,'Mel',1,10,10);
  r := r || ' reconciled=' || public._rm_manual_pdf_enqueue_match(inv2,true);
  -- 3) Allerede matchet linje: ingen ny matching.
  update invoices set reconciled_at=null where id=inv2;
  update invoice_lines set match_confidence='manual' where invoice_id=inv2;
  r := r || ' matched=' || public._rm_manual_pdf_enqueue_match(inv2,true);
  raise exception 'RESULT %', r;
end $$;
-- Forventet: RESULT replay1=true replay2=false queued=1 reconciled=false matched=false
