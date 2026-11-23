-- =====================================================================================
-- DATAENDRING 20.11.2026 · Tøm gamle fakturalinjer og prishistorikk før ny innlesing med EHF
-- Kjøres bare etter Henriks uttrykkelige ja. Filen slutter med ROLLBACK: første kjøring er alltid en
-- prøvekjøring som viser tallene. Bytt siste linje til COMMIT først når tallene er kontrollert.
--
-- Beholdes urørt: råvarer, oppskrifter, deklarasjoner, produkter, leverandører, leverandørkoblinger,
-- aliaser, pakningsvarianter, fakturahodene (invoices) og læringseksempler (invoice_extraction_examples).
-- Kostpris: dagens kostpris låses som manuell pris med SAMME dato som kilden før slettingen, så kalkyler
-- ikke mister pris. Nyere EHF-priser tar over automatisk via vanlig prisvelger.
-- Sikkerhetskopi: alt som slettes/endres kopieres til _backup_*_20261120 først.
-- Lager: lagerbevegelser fra fakturalinjer (60 per 20.11) slettes med linjene og trekkes fra lagerbeholdningen;
-- de kommer tilbake når fakturaene er lest og koblet på nytt. Kopi i _backup_stock_movements_20261120.
-- Leverandørsak: Henrik valgte 20.11.2026 å lukke prisforespørselen MANDIFLAN SKÅLDET 12,5KG
-- (sak 2139751c-2b9f-445f-b958-ef38b0a4ada4). Den kopieres og slettes. Stopper hvis det finnes ANDRE saker.
-- =====================================================================================
begin;

do $$ begin
  if exists (select 1 from public.supplier_deviation_cases where id <> '2139751c-2b9f-445f-b958-ef38b0a4ada4') then
    raise exception 'Stoppet: det finnes andre leverandørsaker enn MANDIFLAN-saken. Avklar dem først.';
  end if;
  if exists (select 1 from public.email_outbox o
              where o.status = 'pending'
                and (o.related_entity_id = '2139751c-2b9f-445f-b958-ef38b0a4ada4'
                     or o.related_entity_id in (select d.id from public.supplier_case_email_drafts d
                                                 where d.case_id = '2139751c-2b9f-445f-b958-ef38b0a4ada4'))) then
    raise exception 'Stoppet: MANDIFLAN-saken har en e-post som venter på utsending.';
  end if;
end $$;

-- 0) Sikkerhetskopi
create table public._backup_invoice_lines_20261120 as select * from public.invoice_lines;
create table public._backup_price_history_20261120 as select * from public.raw_material_price_history where source = 'invoice' or invoice_line_id is not null;
create table public._backup_cost_postings_20261120 as select * from public.invoice_line_cost_postings;
create table public._backup_line_corrections_20261120 as select * from public.invoice_line_corrections;
create table public._backup_approvals_20261120 as select * from public.invoice_internal_approvals where revoked_at is null;
create table public._backup_purchases_20261120 as select * from public.raw_material_purchases where invoice_line_id is not null;
create table public._backup_invoices_20261120 as select * from public.invoices;
create table public._backup_cases_20261120 as select * from public.supplier_deviation_cases;
create table public._backup_case_lines_20261120 as select * from public.supplier_deviation_case_lines;
create table public._backup_case_drafts_20261120 as select * from public.supplier_case_email_drafts;
create table public._backup_case_credits_20261120 as select * from public.supplier_deviation_credits;
create table public._backup_match_suggestions_20261120 as select * from public.invoice_line_match_suggestions;
create table public._backup_review_holds_20261120 as select h.* from public.raw_material_price_review_holds h
  join public.raw_material_price_history p on p.id = h.history_id where p.source = 'invoice' or p.invoice_line_id is not null;
create table public._backup_example_links_20261120 as select id, invoice_line_id, source_correction_id from public.invoice_extraction_examples
  where invoice_line_id is not null or source_correction_id is not null;
create table public._backup_stock_movements_20261120 as select * from public.stock_movements where source_table = 'invoice_lines';
create table public._backup_rm_cost_20261120 as
  select id, current_cost_price, price_source, price_updated_at, cost_source_history_id, cost_basis_status, current_stock from public.raw_materials;
revoke all on public._backup_invoice_lines_20261120, public._backup_price_history_20261120, public._backup_cost_postings_20261120,
  public._backup_line_corrections_20261120, public._backup_approvals_20261120, public._backup_invoices_20261120,
  public._backup_rm_cost_20261120, public._backup_purchases_20261120, public._backup_cases_20261120,
  public._backup_case_lines_20261120, public._backup_case_drafts_20261120, public._backup_case_credits_20261120,
  public._backup_match_suggestions_20261120, public._backup_review_holds_20261120, public._backup_example_links_20261120,
  public._backup_stock_movements_20261120
  from anon, authenticated;

-- 0b) Lukk MANDIFLAN-saken (linjer, kladd og kreditter følger med via ON DELETE CASCADE)
delete from public.supplier_deviation_cases where id = '2139751c-2b9f-445f-b958-ef38b0a4ada4';

-- 1) Lås dagens kostpris som manuell pris (samme dato som dagens kilde, ellers i dag)
insert into public.raw_material_price_history (raw_material_id, price, effective_date, source, notes)
select rm.id, rm.current_cost_price,
       coalesce(h.effective_date, (rm.price_updated_at at time zone 'Europe/Oslo')::date, public.rm_oslo_today()),
       'manual', 'Låst før tømming av fakturalinjer 20.11.2026 (EHF-innlesing)'
  from public.raw_materials rm
  left join public.raw_material_price_history h on h.id = rm.cost_source_history_id
 where rm.current_cost_price is not null and rm.current_cost_price > 0
   and rm.cost_basis_status is distinct from 'mangler';

-- 2) Fjern sperrene som hindrer ny lesing (godkjenning, rettelser, ført kost)
update public.invoice_internal_approvals set revoked_at = now(), revoke_reason = 'Tømt før ny innlesing med EHF 20.11.2026'
 where revoked_at is null;
delete from public.invoice_line_cost_postings;
delete from public.invoice_line_corrections;

-- 3) Slett fakturaprishistorikk og fakturalinjer
delete from public.raw_material_price_history where source = 'invoice' or invoice_line_id is not null;
-- Linjer som er «holdt utenfor» kan ellers ikke slettes (vakt _rm_line_exclusion_guard). Gjelder bare denne transaksjonen.
select set_config('rm.exclusion_write', 'on', true);
delete from public.invoice_lines;
select set_config('rm.exclusion_write', '', true);

-- 4) Legg alle Tripletex-fakturaer i lesekøen på nytt
update public.invoices set
  status = 'imported', reconciled_at = null, flagged_at = null,
  line_extraction_status = 'pending', line_extraction_attempts = 0, line_extraction_error = null,
  line_extraction_token = null, line_extraction_at = null
  where tripletex_supplier_invoice_id is not null and excluded_at is null;

-- 5) Regn kostpris på nytt for alle råvarer (finner den låste prisen)
select count(public.rm_apply_derived_cost_price(id)) from public.raw_materials;

-- Kontroll
select
  (select count(*) from public.invoice_lines) as linjer_igjen,
  (select count(*) from public.supplier_deviation_cases) as saker_igjen,
  (select count(*) from public.stock_movements where source_table = 'invoice_lines') as lagerbevegelser_fra_linjer_igjen,
  (select count(*) from public.raw_materials r join public._backup_rm_cost_20261120 b on b.id = r.id
     where r.current_stock is distinct from b.current_stock) as lagerbeholdning_endret,
  (select count(*) from public.raw_material_price_history where source = 'invoice') as fakturapriser_igjen,
  (select count(*) from public.invoices where line_extraction_status = 'pending') as fakturaer_i_lesekoen,
  (select count(*) from public.raw_materials r join public._backup_rm_cost_20261120 b on b.id = r.id
     where b.current_cost_price is not null and r.current_cost_price is distinct from b.current_cost_price) as kostpris_endret,
  (select count(*) from public.raw_materials r join public._backup_rm_cost_20261120 b on b.id = r.id
     where b.cost_basis_status = 'verifisert' and r.cost_basis_status is distinct from 'verifisert') as mistet_verifisert;

commit;