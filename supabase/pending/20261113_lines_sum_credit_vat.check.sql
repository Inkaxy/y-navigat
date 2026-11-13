-- KONTROLL – bare SELECT, skriver ingenting. Hører til 20261113_lines_sum_credit_vat.PENDING.sql.

-- 1) Forutsetning før kjøring (alle skal være true). Etter kjøring er de tre første false (endret).
select md5(pg_get_functiondef('public.rm_correct_invoice_line(uuid,timestamp with time zone,jsonb,text,boolean,boolean)'::regprocedure)) = '2309db2c778a0db23c2f6bee2852cf86' as correct_uendret,
       md5(pg_get_functiondef('public.rm_apply_invoice_reread(uuid,jsonb,text)'::regprocedure)) = 'dc58b00ca0774c576f7fa8c8c044df4d' as apply_uendret,
       md5(pg_get_functiondef('public.rm_finalize_invoice_line_extraction(uuid,uuid,jsonb,jsonb)'::regprocedure)) = 'e2d12782ccbe9b5cd7a3211fa4e9724c' as finalize_uendret,
       md5(pg_get_functiondef('public.rm_lines_sum_check(numeric,integer,numeric,numeric)'::regprocedure)) = '531e59387ca1103d33d6095ab6ca0a08' as sumcheck4_uendret,
       to_regprocedure('public.rm_lines_sum_check(numeric,integer,numeric,numeric,boolean)') is not null as sumcheck5_finnes;

-- 2) Etter kjøring: kallerne bruker 5-argumentsversjonen, finalize kjenner total_vat_zero_replaced.
select position('coalesce(v.is_credit_note, false))' in pg_get_functiondef('public.rm_correct_invoice_line(uuid,timestamp with time zone,jsonb,text,boolean,boolean)'::regprocedure)) > 0 as correct_kreditt,
       position('coalesce(v.is_credit_note,false))' in pg_get_functiondef('public.rm_apply_invoice_reread(uuid,jsonb,text)'::regprocedure)) > 0 as apply_kreditt,
       (length(pg_get_functiondef('public.rm_finalize_invoice_line_extraction(uuid,uuid,jsonb,jsonb)'::regprocedure))
        - length(replace(pg_get_functiondef('public.rm_finalize_invoice_line_extraction(uuid,uuid,jsonb,jsonb)'::regprocedure), 'total_vat_zero_replaced', '')))
        / length('total_vat_zero_replaced') = 2 as finalize_mva0;

-- 3) Kreditnotaer som i dag har sumavvik, og hva ny regel gir (etter kjøring). Bare lesing.
--    Forventet: de med samme størrelse og motsatt fortegn blir ok; reelle størrelsesavvik forblir mismatch.
select i.invoice_number, s.name as leverandor, i.total_amount, i.total_vat, i.lines_sum_excl_vat, i.lines_sum_variance_pct,
       public.rm_lines_sum_check(i.lines_sum_excl_vat, (select count(*)::int from public.invoice_lines l where l.invoice_id = i.id),
                                 i.total_amount, i.total_vat) as i_dag,
       case when to_regprocedure('public.rm_lines_sum_check(numeric,integer,numeric,numeric,boolean)') is not null
            then public.rm_lines_sum_check(i.lines_sum_excl_vat, (select count(*)::int from public.invoice_lines l where l.invoice_id = i.id),
                                 i.total_amount, i.total_vat, true) end as etter
  from public.invoices i left join public.suppliers s on s.id = i.supplier_id
 where i.is_credit_note = true and i.lines_sum_status = 'mismatch'
 order by i.invoice_date desc;

-- 4) Fakturaer med mva 0 på hodet (punkt E). Lantmännen-tilfellene får bilagets mva ved neste lesing.
select s.name as leverandor, count(*) as antall, sum(case when i.is_credit_note then 1 else 0 end) as kreditnotaer
  from public.invoices i left join public.suppliers s on s.id = i.supplier_id
 where i.total_vat = 0 and i.tripletex_supplier_invoice_id is not null
 group by s.name order by antall desc;
