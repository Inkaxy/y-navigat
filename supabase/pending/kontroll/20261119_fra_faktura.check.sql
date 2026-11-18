-- Kontroll etter 20261119_fra_faktura.PENDING.sql. Bare SELECT.
select 'kolonner i invoice_match_settings' as kontroll,
       (select count(*) from information_schema.columns where table_schema='public' and table_name='invoice_match_settings'
         and column_name in ('price_jump_pct','fra_faktura_quiet_prices','fra_faktura_invoice_package')) = 3 as ok
union all select 'kolonner i raw_materials',
       (select count(*) from information_schema.columns where table_schema='public' and table_name='raw_materials'
         and column_name in ('price_jump_pct','cost_basis_rule')) = 2
union all select 'kolonne suppliers.new_item_type',
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='suppliers' and column_name='new_item_type')
union all select 'ingen data endret: alle nye felt er null',
       not exists (select 1 from public.invoice_match_settings where price_jump_pct is not null or fra_faktura_quiet_prices is not null or fra_faktura_invoice_package is not null)
       and not exists (select 1 from public.raw_materials where price_jump_pct is not null or cost_basis_rule is not null)
       and not exists (select 1 from public.suppliers where new_item_type is not null)
union all select '_rm_cost_candidates bruker regelen',
       position('_rm_cost_rule_ok' in pg_get_functiondef('public._rm_cost_candidates(uuid,date)'::regprocedure)) > 0
union all select 'nye funksjoner finnes',
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in
         ('rm_fra_faktura_settings','rm_set_fra_faktura_settings','rm_set_item_price_jump','rm_set_supplier_new_item_type',
          'rm_remember_supplier_item_names','rm_undo_supplier_item_link','rm_set_cost_basis_rule','_rm_cost_rule_ok','rm_cap_fra_faktura_v1')) = 9
union all select 'anon har ikke tilgang',
       not has_function_privilege('anon', 'public.rm_undo_supplier_item_link(uuid,uuid,text,uuid[],uuid,boolean,text)', 'execute')
union all select 'cap', public.rm_cap_fra_faktura_v1();

-- Råvarer som kan få annen kostpris ved neste omregning (kjøp fra flere leverandører):
select rm.id, rm.name, rm.current_cost_price,
       (select price from public._rm_cost_candidates(rm.id, current_date) limit 1) as ny_kandidat
  from public.raw_materials rm
 where rm.id in (select raw_material_id from public.raw_material_price_history
                  where source = 'invoice' and superseded_at is null and supplier_id is not null
                  group by 1 having count(distinct supplier_id) > 1);
