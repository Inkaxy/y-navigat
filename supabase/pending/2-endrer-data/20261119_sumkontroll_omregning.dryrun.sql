-- DRY-RUN (bare SELECT, endrer ingenting): hvilke åpne fakturaer med «summen stemmer ikke» ville fått en annen
-- status med dagens sumkontroll (rm_lines_sum_check med kreditnota/mva-rettelsen fra 15.11)?
-- Linjegrunnlaget er det samme som serveren bruker ved retting og gjenlesing: alle linjer på fakturaen.
-- Målt read-only 17.11.2026 kl. 11:40 UTC (samme regel skrevet ut i SQL): 38 åpne med avvik, alle har linjer;
-- 6 ville blitt «ok» – alle er kreditnotaer. 32 står fortsatt med avvik.
-- Bytt selskaps-ID om nødvendig (Nøtterø Bakeri).
with cand as (
  select i.id, i.invoice_number, i.invoice_date, i.total_amount, i.total_vat, coalesce(i.is_credit_note, false) is_credit,
         i.lines_sum_status old_status, i.lines_sum_excl_vat old_sum, i.lines_sum_variance_pct old_pct,
         (select count(*)::int from invoice_lines l where l.invoice_id = i.id) n,
         (select sum(l.total_amount) from invoice_lines l where l.invoice_id = i.id) s
    from invoices i
   where i.legal_entity_id = '751709bc-04b3-4449-867d-b97faa9ab373'
     and i.status in ('imported','needs_review','ready') and i.excluded_at is null and i.flagged_at is null
     and i.lines_sum_status = 'mismatch'
), calc as (
  select c.*, public.rm_lines_sum_check(c.s, c.n, c.total_amount, c.total_vat, c.is_credit) r from cand c
)
select id, invoice_number, invoice_date, is_credit, old_status, r->>'lines_sum_status' as new_status,
       old_pct, (r->>'lines_sum_variance_pct')::numeric as new_pct
  from calc
 order by (r->>'lines_sum_status') = 'mismatch', invoice_date, id;

-- Sammendrag:
-- select r->>'lines_sum_status' as ny_status, count(*), count(*) filter (where is_credit) as kreditnotaer from calc group by 1;
