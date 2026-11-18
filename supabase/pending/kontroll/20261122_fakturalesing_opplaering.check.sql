-- Kontroll for 20261122_fakturalesing_opplaering.PENDING.sql. Bare SELECT; skriver ingenting.
-- (query_to_xml brukes der tabellen/kolonnen først finnes etter kjøringen, slik at samme fil kan kjøres før og etter.)
-- Kjør før (for_ok skal være true på alle rader) og etter (etter_ok skal være true på alle rader).
select kontroll, for_ok, etter_ok from (
  select 1 n, 'markør rm_cap_fakturalesing_v1' kontroll,
         to_regprocedure('public.rm_cap_fakturalesing_v1()') is null for_ok,
         to_regprocedure('public.rm_cap_fakturalesing_v1()') is not null etter_ok
  union all select 2, 'nye tabeller',
         to_regclass('public.invoice_reading_settings') is null and to_regclass('public.invoice_supplier_profiles') is null
           and to_regclass('public.invoice_gold_invoices') is null and to_regclass('public.invoice_reading_log') is null,
         to_regclass('public.invoice_reading_settings') is not null and to_regclass('public.invoice_supplier_profiles') is not null
           and to_regclass('public.invoice_gold_invoices') is not null and to_regclass('public.invoice_reading_log') is not null
  union all select 3, 'RLS på alle nye tabeller', true,
         coalesce((select bool_and(relrowsecurity) from pg_class where oid in (
           to_regclass('public.invoice_reading_settings'), to_regclass('public.invoice_supplier_profiles'),
           to_regclass('public.invoice_gold_invoices'), to_regclass('public.invoice_reading_log'))), false)
  union all select 4, 'nye kolonner på invoice_extraction_examples',
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'invoice_extraction_examples'
           and column_name in ('source_kind', 'invoice_id', 'invoice_line_id', 'item_key')) = 0,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'invoice_extraction_examples'
           and column_name in ('source_kind', 'invoice_id', 'invoice_line_id', 'item_key')) = 4
  union all select 5, 'alt er AV: ingen innstillingsrad med noe på', true,
         case when to_regclass('public.invoice_reading_settings') is null then false else
           (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.invoice_reading_settings where catalog_enabled or profile_enabled or learning_enabled or self_check_enabled', false, true, '')))[1]::text = '0' end
  union all select 6, 'anon kan ikke kalle noen av de nye funksjonene', true,
         coalesce((select bool_and(not has_function_privilege('anon', p.oid, 'execute')) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.proname in ('rm_reading_settings', 'rm_save_reading_settings', 'rm_reading_model_options', 'rm_supplier_reading_catalog',
             'rm_supplier_profiles', 'rm_supplier_profile_draft_stats', 'rm_save_supplier_profile', 'rm_supplier_profile_for_reading', 'rm_record_extraction_example',
             'rm_extraction_examples_list', 'rm_extraction_examples_for_v2', 'rm_mark_gold_invoice', 'rm_unmark_gold_invoice',
             'rm_gold_invoices', '_rm_reading_read_guard', '_rm_reading_approve_guard')), false)
  union all select 7, 'hjelpefunksjonene er ikke kallbare fra klient', true,
         coalesce((select bool_and(not has_function_privilege('authenticated', p.oid, 'execute')) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.proname in ('_rm_reading_read_guard', '_rm_reading_approve_guard')), false)
  union all select 8, 'innloggede og tjenesten kan kalle RPC-ene', true,
         coalesce((select bool_and(has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute'))
           from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.proname in ('rm_reading_settings', 'rm_supplier_reading_catalog', 'rm_record_extraction_example', 'rm_gold_invoices')), false)
  union all select 9, 'eksisterende eksempler urørt (source_kind tom på gamle rader)', true,
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'invoice_extraction_examples' and column_name = 'source_kind') = 0
           then false else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.invoice_extraction_examples where source_kind is not null and created_at < ''2026-11-18''', false, true, '')))[1]::text = '0' end
  union all select 10, 'rm_extraction_examples_for (v1) er uendret',
         md5(replace(pg_get_functiondef('public.rm_extraction_examples_for(uuid,uuid,integer)'::regprocedure), chr(13), '')) = 'f7d5e490a436da2aef661cbcbda31f38'
           or to_regclass('public.audit_log') is null,
         md5(replace(pg_get_functiondef('public.rm_extraction_examples_for(uuid,uuid,integer)'::regprocedure), chr(13), '')) = 'f7d5e490a436da2aef661cbcbda31f38'
           or to_regclass('public.audit_log') is null
) k order by n;
-- STOPP (resten er bare informasjon fra live)
select count(*) as eksempler_totalt, count(*) filter (where is_active) as aktive from public.invoice_extraction_examples;
select count(*) filter (where reason like 'Samlet gjenlesing%') as automatiske_rettinger, count(*) as rettinger_totalt from public.invoice_line_corrections;
select s.name, count(rms.id) as kjente_varer from public.suppliers s left join public.raw_material_suppliers rms on rms.supplier_id = s.id
 where s.track_invoice_lines group by 1 order by 2 desc;
