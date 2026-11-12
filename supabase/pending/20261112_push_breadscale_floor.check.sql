-- KONTROLL – bare SELECT, skriver ingenting. Hører til
-- 20261112_push_breadscale_floor.PENDING.sql. Kan kjøres før og etter.

-- 1) Forutsetning: live-definisjonen er den som ble lest 12.11.2026.
--    Før kjøring: md5 = 0fc4425e0c29df93842dd57a4743059e.
--    Etter kjøring skal round(rec.breadscale_pct) være borte og floor(...) finnes én gang.
select md5(pg_get_functiondef('public.push_products_to_nettside()'::regprocedure)) as md5,
       position('round(rec.breadscale_pct)' in pg_get_functiondef('public.push_products_to_nettside()'::regprocedure)) > 0 as har_round,
       position('floor(rec.breadscale_pct)' in pg_get_functiondef('public.push_products_to_nettside()'::regprocedure)) > 0 as har_floor;

-- 2) Varer som får et annet tall i push enn i dag. Samme utvalg og samme
--    prosentkilde som funksjonen (versjonert → godkjent versjon, legacy → varen),
--    og samme merkeregel (product_breadscale_claim_ok). Tom liste = ingen endring.
select p.display_number,
       p.display_name,
       x.breadscale_pct                as lagret_pct,
       public.breadscale_step(x.breadscale_pct) as trinn,
       round(x.breadscale_pct)         as sendes_i_dag,
       floor(x.breadscale_pct)         as sendes_etter
  from public.products p
  left join public.recipe_declaration_versions dv on dv.id = p.declaration_version_id
  cross join lateral (
    select case when p.declaration_version_id is not null then dv.breadscale_pct
                else p.breadscale_pct end as breadscale_pct
  ) x
 where p.legal_entity_id = '751709bc-04b3-4449-867d-b97faa9ab373'
   and p.status = 'active'
   and p.in_web_shop = true
   and coalesce(public.product_breadscale_claim_ok(p.id), false)
   and round(x.breadscale_pct) is distinct from floor(x.breadscale_pct)
 order by p.display_number;
