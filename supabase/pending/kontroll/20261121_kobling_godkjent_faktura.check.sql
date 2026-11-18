-- Kontroll for 20261121_kobling_godkjent_faktura.PENDING.sql. Bare SELECT – endrer ingenting. Kjøres av root før OG etter.
-- Første spørring: hver kontroll har forventet verdi før (for_ok) og etter (etter_ok). Alle i riktig kolonne skal være true.
-- Selskaps-ID er Nøtterø Bakeri.
with d as (
  select replace(pg_get_functiondef('public.rm_confirm_line_match(uuid,uuid,numeric,text,numeric,boolean,numeric,boolean,uuid[],boolean)'::regprocedure), chr(13), '') confirm,
         replace(pg_get_functiondef('public.rm_link_supplier_item(uuid,uuid,text,uuid,jsonb,jsonb,boolean,boolean,text,uuid[])'::regprocedure), chr(13), '') link,
         replace(pg_get_functiondef('public.rm_undo_not_item(uuid,uuid,text,uuid[],boolean,text)'::regprocedure), chr(13), '') undo_not,
         replace(pg_get_functiondef('public.rm_set_invoice_exclusion(uuid,text,uuid,text,text,text,uuid)'::regprocedure), chr(13), '') excl,
         replace(pg_get_functiondef('public.rm_work_items(uuid,text,text,uuid,text,integer,integer)'::regprocedure), chr(13), '') wi,
         to_regprocedure('public.rm_cap_kobling_godkjent_v1()') is not null cap
), q as (
  select (public.rm_work_items('751709bc-04b3-4449-867d-b97faa9ab373'::uuid, 'kobling', null, null, 'oldest', 500, 0)) r
), k as (
  select
    (select count(*) from jsonb_array_elements((select r from q)->'items') x where (x->>'open_lines')::int = 0) zero_rows,
    ((select r from q)->>'total')::int <= 500 complete
), c as (
  select
    md5(confirm) = 'e2958f267da2cb5fc70f1af49c97d60a' m1, md5(link) = 'acc4fdb14510e96d4b21cb5b7e74d28a' m2,
    md5(undo_not) = '7855ce549d7802eea49daef4d7179057' m3, md5(excl) = '67856afa654835ae12a3903f2984d92e' m4,
    md5(wi) = 'efe0f95ef98471bbfca5713d05960e27' m5, cap,
    strpos(confirm, 'faktura_godkjent') > 0 confirm_guard,
    strpos(confirm, 'rm.link_approved') > 0 confirm_bypass,
    strpos(link, 'invoice_internal_approvals') = 0 link_no_filter,
    strpos(link, 'set_config(''rm.link_approved'', ''on'', true)') > 0 and strpos(link, 'set_config(''rm.link_approved'', '''', true)') > 0 link_scoped,
    strpos(undo_not, 'faktura_godkjent') = 0 undo_open,
    (length(excl) - length(replace(excl, 'faktura_godkjent', ''))) / length('faktura_godkjent') excl_guards,
    strpos(wi, 'invoice_line_cost_postings cp') > 0 and strpos(wi, 'a.linked_rm_id is null and a.open_lines > 0') > 0 wi_rule
  from d
)
select kontroll, for_ok, etter_ok from c, k, lateral (values
  ('rm_confirm_line_match md5 17.11',               m1, not m1),
  ('rm_link_supplier_item md5 17.11',               m2, not m2),
  ('rm_undo_not_item md5 17.11',                    m3, not m3),
  ('rm_set_invoice_exclusion md5 17.11',            m4, not m4),
  ('rm_work_items md5 17.11',                       m5, not m5),
  ('markør rm_cap_kobling_godkjent_v1',             not cap, cap),
  ('forkastet alternativ B er ikke kjørt',          to_regprocedure('public.rm_cap_ko_uten_godkjent_v1()') is null, to_regprocedure('public.rm_cap_ko_uten_godkjent_v1()') is null),
  ('direkte linjekobling er fortsatt sperret',      confirm_guard and not confirm_bypass, confirm_guard and confirm_bypass),
  ('koblingen forkaster ikke godkjente linjer',     not link_no_filter, link_no_filter and link_scoped),
  ('angre «Ikke vare» godtar godkjente linjer',     not undo_open, undo_open),
  ('hold utenfor: bare hele fakturaen sperret',     excl_guards = 2, excl_guards = 1),
  ('køen: ført kost ikke åpen, ukoblet krever linje', not wi_rule, wi_rule),
  ('Nye varer: ingen rad med 0 linjer (komplett)',  complete, complete and zero_rows = 0)
) v(kontroll, for_ok, etter_ok);

-- Omfang (informasjon): åpne linjer på internt godkjente, åpne fakturaer som nå kan kobles.
-- 17.11 kl. 14:2x: 0 – alle 437 interne godkjenninger var trukket tilbake (status revoked).
select count(*) linjer, count(distinct il.invoice_id) fakturaer
  from invoice_lines il join invoices i on i.id = il.invoice_id
 where il.requires_review and il.excluded_at is null and i.status in ('imported','needs_review','ready') and i.flagged_at is null
   and coalesce(il.match_confidence,'') <> 'not_applicable'
   and exists (select 1 from invoice_internal_approvals a where a.invoice_id = i.id and a.status = 'approved' and a.revoked_at is null);

-- Godkjenningsgrunnlaget: antall aktive godkjenninger der lagret grunnlag avviker fra fakturaen i dag.
-- Skal være det samme før kjøring, etter kjøring og etter koblinger på godkjente fakturaer.
select count(*) avvik_fra_godkjent_grunnlag
  from invoice_internal_approvals a join invoices i on i.id = a.invoice_id
 where a.status = 'approved' and a.revoked_at is null
   and ((a.basis->>'total_amount')::numeric is distinct from i.total_amount
     or (a.basis->>'total_vat')::numeric is distinct from i.total_vat
     or a.basis->>'currency' is distinct from i.currency
     or a.basis->>'lines_sum_status' is distinct from i.lines_sum_status
     or (a.basis->>'lines_sum_excl_vat')::numeric is distinct from i.lines_sum_excl_vat
     or a.basis->>'status' is distinct from i.status);
