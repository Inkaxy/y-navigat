-- Kontroll for 02_ehf_forst.sql (bare SELECT). Før kjøring: kolonnen_finnes = false. Etter: alle ok = true.
select 'kolonnen_finnes' as kontroll,
       exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'invoice_reading_settings' and column_name = 'ehf_first') as ok
union all
select 'standard_av',
       coalesce((select column_default = 'false' and is_nullable = 'NO' from information_schema.columns
                 where table_schema = 'public' and table_name = 'invoice_reading_settings' and column_name = 'ehf_first'), false);
