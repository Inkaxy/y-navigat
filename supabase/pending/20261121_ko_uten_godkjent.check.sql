-- Bare SELECT. Kjør før og etter 20261121_ko_uten_godkjent.PENDING.sql.
select 'rm_work_items md5 17.11' k, md5(pg_get_functiondef('public.rm_work_items(uuid,text,text,uuid,text,integer,integer)'::regprocedure)) = 'efe0f95ef98471bbfca5713d05960e27' v
union all select 'rm_new_items_queue finnes (20261119 kjørt)', to_regprocedure('public.rm_new_items_queue(uuid,uuid,integer,integer)') is not null
union all select 'markør B finnes', to_regprocedure('public.rm_cap_ko_uten_godkjent_v1()') is not null
union all select 'alternativ A er IKKE kjørt', to_regprocedure('public.rm_cap_kobling_godkjent_v1()') is null;

-- Leverandørvarer i Nye varer som bare har linjer på godkjente fakturaer (17.11: 47) – skal bli 0 i køen etter kjøring.
with l as (
  select i.supplier_id, case when public.rm_sku_norm(il.supplier_sku) <> '' then 'sku:' || public.rm_sku_norm(il.supplier_sku)
           else 'name:' || public.rm_match_key(il.description) end item_key,
         exists (select 1 from invoice_internal_approvals a where a.invoice_id = i.id and a.status = 'approved') appr
    from invoice_lines il join invoices i on i.id = il.invoice_id
   where il.requires_review and il.raw_material_id is null and il.excluded_at is null
     and coalesce(il.match_confidence,'') <> 'not_applicable'
     and i.status in ('imported','needs_review','ready') and i.flagged_at is null
)
select count(*) filter (where bool_and_appr) bare_godkjente, count(*) filter (where any_appr and not bool_and_appr) delvis
  from (select supplier_id, item_key, bool_and(appr) bool_and_appr, bool_or(appr) any_appr from l group by 1, 2) x;
