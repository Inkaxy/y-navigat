-- DRY-RUN (bare SELECT, skriver ingenting): helt like linjer på samme åpne faktura (bestilling 18.11 punkt C6).
-- «Helt like» = samme varenummer, tekst, mengde, enhetspris og linjesum. Åpen = ikke avstemt, ikke kansellert, ikke utelatt.
--
-- Funn 18.11.2026 (lesespørringer): 41 grupper, 64 linjer for mye, 30 fakturaer.
--  - EKTE (35 grupper): alle linjene kom i samme lesing (samme sekund), og fakturaens linjesum stemmer MED dem.
--    Coca-Cola trykker pant per vare (flere like pantlinjer), PALS/Flemming Egg/Idun/Drammen Papir har samme vare
--    på flere leveranser. Disse skal stå.
--  - REST FRA GJENLESING (6 fakturaer, alle Coca-Cola): samlet gjenlesing 17.11 la til pantlinjer
--    (audit_log action 'invoice_line.reread_added'), men kan ikke fjerne linjer. Linjesummen ble for høy med
--    nøyaktig beløpet til de tillagte duplikatene (96 kr på fem fakturaer, 240 kr på 9204947561).
--    Forslag: fjern 11 linjer (se 20261122_like_linjer.DATAENDRING.sql). På 9204947561 er overskuddet 240 kr,
--    så bare én av de to tillagte 240-linjene foreslås fjernet. Spørring 2 under gav nøyaktig disse 11 linjene 18.11.

-- 1) Alle grupper med klassifisering
with grp as (
  select l.invoice_id, l.supplier_sku, l.description, l.quantity, l.unit_price, l.total_amount,
         count(*) as antall, count(*) - 1 as for_mye,
         count(*) filter (where exists (select 1 from public.audit_log a where a.action = 'invoice_line.reread_added' and a.entity_id = l.id)) as lagt_til_av_gjenlesing,
         count(distinct date_trunc('second', l.created_at)) as lesinger
    from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
   where i.status not in ('reconciled', 'cancelled') and i.excluded_at is null
   group by 1, 2, 3, 4, 5, 6 having count(*) > 1
)
select s.name as leverandor, i.invoice_number, i.status, i.lines_sum_status, i.lines_sum_variance_pct,
       g.supplier_sku, left(g.description, 40) as tekst, g.total_amount, g.antall, g.for_mye, g.lagt_til_av_gjenlesing,
       case when g.lagt_til_av_gjenlesing > 0 then 'rest_fra_gjenlesing?' else 'ekte (samme lesing)' end as vurdering
  from grp g join public.invoices i on i.id = g.invoice_id left join public.suppliers s on s.id = i.supplier_id
 order by vurdering desc, s.name, i.invoice_number;

-- 2) Forslag per faktura: tillagte duplikater som akkurat dekker overskuddet (linjesum − sum eks. mva)
with inv as (
  select i.id, i.invoice_number, i.total_amount - coalesce(i.total_vat, 0) as eks_mva,
         (select sum(total_amount) from public.invoice_lines x where x.invoice_id = i.id) as linjesum
    from public.invoices i
   where i.status not in ('reconciled', 'cancelled') and i.excluded_at is null and not coalesce(i.is_credit_note, false)
), cand as (
  select inv.invoice_number, inv.eks_mva, inv.linjesum, round(inv.linjesum - inv.eks_mva, 2) as overskudd, l.id as line_id, l.line_number,
         l.description, l.total_amount, l.updated_at,
         sum(l.total_amount) over (partition by l.invoice_id order by l.total_amount desc, l.created_at desc, l.id) as lopende
    from inv join public.invoice_lines l on l.invoice_id = inv.id
   where exists (select 1 from public.audit_log a where a.action = 'invoice_line.reread_added' and a.entity_id = l.id)
     and exists (select 1 from public.invoice_lines o where o.invoice_id = l.invoice_id and o.id <> l.id and o.created_at < l.created_at
                   and o.supplier_sku is not distinct from l.supplier_sku and o.description is not distinct from l.description
                   and o.quantity is not distinct from l.quantity and o.unit_price is not distinct from l.unit_price
                   and o.total_amount is not distinct from l.total_amount)
)
select invoice_number, eks_mva, linjesum, overskudd, line_id, line_number, left(description, 40) as tekst, total_amount, updated_at,
       lopende <= overskudd + 0.005 as foreslatt_fjernet
  from cand where overskudd > 0
 order by invoice_number, line_number;
