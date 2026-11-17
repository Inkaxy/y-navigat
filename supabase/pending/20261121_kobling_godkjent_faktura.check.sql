-- Bare SELECT. Kjør før og etter 20261121_kobling_godkjent_faktura.PENDING.sql.
-- 1) Forutsetninger (før: alle md5 = true; etter: md5 = false og markør = true).
select 'rm_confirm_line_match md5 17.11' k, md5(pg_get_functiondef('public.rm_confirm_line_match(uuid,uuid,numeric,text,numeric,boolean,numeric,boolean,uuid[],boolean)'::regprocedure)) = 'e2958f267da2cb5fc70f1af49c97d60a' v
union all select 'rm_link_supplier_item md5 17.11', md5(pg_get_functiondef('public.rm_link_supplier_item(uuid,uuid,text,uuid,jsonb,jsonb,boolean,boolean,text,uuid[])'::regprocedure)) = 'acc4fdb14510e96d4b21cb5b7e74d28a'
union all select 'rm_work_items md5 17.11', md5(pg_get_functiondef('public.rm_work_items(uuid,text,text,uuid,text,integer,integer)'::regprocedure)) = 'efe0f95ef98471bbfca5713d05960e27'
union all select 'markør A finnes', to_regprocedure('public.rm_cap_kobling_godkjent_v1()') is not null
union all select 'alternativ B er IKKE kjørt', to_regprocedure('public.rm_cap_ko_uten_godkjent_v1()') is null
union all select 'etter: link setter rm.link_approved', pg_get_functiondef('public.rm_link_supplier_item(uuid,uuid,text,uuid,jsonb,jsonb,boolean,boolean,text,uuid[])'::regprocedure) like '%set_config(''rm.link_approved''%';

-- 2) Omfang: åpne linjer på internt godkjente, åpne fakturaer (17.11: 207 linjer totalt).
select count(*) linjer, count(distinct il.invoice_id) fakturaer
  from invoice_lines il join invoices i on i.id = il.invoice_id
 where il.requires_review and il.excluded_at is null and i.status in ('imported','needs_review','ready') and i.flagged_at is null
   and coalesce(il.match_confidence,'') <> 'not_applicable'
   and exists (select 1 from invoice_internal_approvals a where a.invoice_id = i.id and a.status = 'approved');

-- 3) Godkjenningsgrunnlaget skal være uendret: antall godkjenninger der lagret grunnlag avviker fra fakturaen i dag.
--    Tallet skal være det samme før og etter kjøring og etter koblinger.
select count(*) avvik_fra_godkjent_grunnlag
  from invoice_internal_approvals a join invoices i on i.id = a.invoice_id
 where a.status = 'approved'
   and ((a.basis->>'total_amount')::numeric is distinct from i.total_amount
     or (a.basis->>'total_vat')::numeric is distinct from i.total_vat
     or a.basis->>'currency' is distinct from i.currency
     or a.basis->>'lines_sum_status' is distinct from i.lines_sum_status
     or (a.basis->>'lines_sum_excl_vat')::numeric is distinct from i.lines_sum_excl_vat
     or a.basis->>'status' is distinct from i.status);

-- 4) Køen og koblingen er enige: åpne linjer med aktiv ført kostpris (skal være 0; var 0 17.11).
select count(*) apne_med_fort_kost from invoice_lines il
  join invoice_line_cost_postings p on p.invoice_line_id = il.id and p.revoked_at is null where il.requires_review;
