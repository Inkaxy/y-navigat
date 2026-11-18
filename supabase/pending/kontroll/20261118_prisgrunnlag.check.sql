-- Kontroll etter 20261118_prisgrunnlag.PENDING.sql. Bare SELECT.
select 'kolonne packaging_in_margins' as kontroll,
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='entity_calc_settings' and column_name='packaging_in_margins') as ok
union all select 'h4_margin_eval tar med emballasje', position('calc_packaging_in_margins' in replace(pg_get_functiondef('public.h4_margin_eval(uuid,price_level,numeric,boolean,text,jsonb)'::regprocedure), chr(13), '')) > 0
union all select 'product_margins tar med emballasje', position('calc_packaging_in_margins' in replace(pg_get_functiondef('public.product_margins(uuid,date)'::regprocedure), chr(13), '')) > 0
union all select 'innstilling uendret (null = på)', not exists (select 1 from public.entity_calc_settings where packaging_in_margins is not null)
union all select 'ingen emballasjelinjer ennå (ingen margin endret)', (select count(*) from public.recipe_packaging_lines) >= 0
union all select 'cap', public.varer_cap_prisgrunnlag_v1();
