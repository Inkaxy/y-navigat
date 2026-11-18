-- DATAENDRING – IKKE KJØRT. Tas separat med Henrik etter dry-run (20261119_sumkontroll_omregning.dryrun.sql).
-- Regner sumkontrollen på nytt med dagens rm_lines_sum_check for ÅPNE fakturaer som i dag står med
-- «summen stemmer ikke», og endrer bare dem som da får en annen status (forventet 17.11: 6 kreditnotaer → ok).
-- Ingen linjer endres. Fakturaer som er avstemt, godkjent, har ført kost, er flagget eller holdt utenfor røres ikke.
-- Fakturaer som i dag står som «ok» røres ikke, selv om dagens regel skulle gitt avvik.
-- Hver endring loggføres i audit_log ('invoice.sum_rechecked', gammel og ny verdi), slik at den kan spores og rulles
-- tilbake manuelt. Statusbyttet trigger trg_rm_price_invoice_integrity (ny prisberegning for berørte råvarer).
-- Bundet til live-md5 av rm_lines_sum_check(numeric,integer,numeric,numeric,boolean) 17.11.2026.
-- Bytt selskaps-ID om nødvendig (Nøtterø Bakeri). Kjøres som én transaksjon.
begin;

do $$
begin
  if md5(pg_get_functiondef('public.rm_lines_sum_check(numeric,integer,numeric,numeric,boolean)'::regprocedure)) <> 'cd7ff540627265d66f719614c77beaab' then
    raise exception 'rm_lines_sum_check er endret siden 17.11.2026 – kjør dry-run på nytt og oppdater filen';
  end if;
end $$;

with cand as (
  select i.id, i.invoice_number, i.legal_entity_id, i.total_amount, i.total_vat, coalesce(i.is_credit_note, false) is_credit,
         i.lines_sum_status old_status, i.lines_sum_excl_vat old_sum, i.lines_sum_variance_pct old_pct,
         (select count(*)::int from invoice_lines l where l.invoice_id = i.id) n,
         (select sum(l.total_amount) from invoice_lines l where l.invoice_id = i.id) s
    from invoices i
   where i.legal_entity_id = '751709bc-04b3-4449-867d-b97faa9ab373'
     and i.status in ('imported','needs_review','ready') and i.reconciled_at is null
     and i.excluded_at is null and i.flagged_at is null
     and i.lines_sum_status = 'mismatch'
     and not exists (select 1 from invoice_internal_approvals a where a.invoice_id = i.id and a.revoked_at is null)
     and not exists (select 1 from invoice_line_cost_postings p where p.invoice_id = i.id and p.revoked_at is null)
   for update of i
), calc as (
  select c.*, public.rm_lines_sum_check(c.s, c.n, c.total_amount, c.total_vat, c.is_credit) r from cand c
), upd as (
  update invoices i set
    lines_sum_status = c.r->>'lines_sum_status',
    lines_sum_excl_vat = (c.r->>'lines_sum_excl_vat')::numeric,
    lines_sum_variance_pct = (c.r->>'lines_sum_variance_pct')::numeric
  from calc c
  where i.id = c.id and i.lines_sum_status = 'mismatch' and c.r->>'lines_sum_status' is distinct from 'mismatch'
  returning i.id, c.invoice_number, c.legal_entity_id, c.old_status, c.old_sum, c.old_pct, c.r
)
insert into audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
select null, 'invoice.sum_rechecked', 'invoice', u.id, u.invoice_number, u.legal_entity_id,
       jsonb_build_object('old', jsonb_build_object('lines_sum_status', u.old_status, 'lines_sum_excl_vat', u.old_sum, 'lines_sum_variance_pct', u.old_pct),
                          'new', u.r, 'file', '20261119_sumkontroll_omregning.DATAENDRING.sql'),
       'Sumkontroll regnet på nytt med rettet regel (kreditnota/mva 15.11.2026)', 'ravarer'
  from upd u;

-- Kontroll før commit: antall endret i denne kjøringen (forventet 6 per 17.11.2026).
select count(*) as endret from audit_log
 where action = 'invoice.sum_rechecked' and changes->>'file' = '20261119_sumkontroll_omregning.DATAENDRING.sql'
   and occurred_at >= now() - interval '1 minute';

commit;
