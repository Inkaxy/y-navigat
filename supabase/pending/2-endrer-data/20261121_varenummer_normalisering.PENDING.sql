-- PENDING – kjøres av root etter gjennomgang. Bare ADDITIVT: to nye funksjoner. Endrer ingen data og ingen
-- eksisterende funksjon.
--
-- Bakgrunn (Henrik 17.11.2026): samme vare er lest med ulike varenumre hos samme leverandør, f.eks. ASKO
-- «29 9727» / «299727» / «9727» / «305-11» (ISTE CHAI) og PALS «8009» / «8009 5» (gluten- og melkefri kanelbolle).
-- Varenøkkelen (sku:<rm_sku_norm> ellers name:<rm_match_key>) blir da ulik, hver lesing blir en «ny vare», og
-- koblinger læres aldri.
--
-- Regel for foreslått varenummer per leverandør + varenavnnøkkel (rm_match_key):
--   * kandidater = ulike rm_sku_norm-verdier med minst 4 tegn, unntatt ASKO-koder på formen «305-11»/«331-1»/«305-1/1»
--     (de skifter mellom fakturaer for samme vare og deles av ulike varer – ikke varenummer)
--   * forslaget er den lengste kandidaten når ALLE andre kandidater er en avkortet del av den (foran: «9727» av
--     «299727»; bak: «8009» av «80095»). Finnes to kandidater som ikke passer slik, foreslås ingenting.
--   * linjer uten varenummer, med ASKO-kode eller med avkortet nummer får forslaget.
-- Bare åpne, ukoblede linjer på åpne fakturaer uten intern godkjenning og uten ført kostpris kan endres
-- (`can_change`). Selve endringen ligger i egen fil: 20261121_varenummer_normalisering.DATAENDRING.sql.

create or replace function public._rm_sku_canon_plan(p_legal_entity_id uuid)
returns table (
  line_id uuid, invoice_id uuid, invoice_number text, invoice_date date, supplier_id uuid, supplier_name text,
  match_key text, description text, current_sku text, proposed_sku text, reason text, can_change boolean, blocker text
)
language sql stable security definer set search_path = public
as $$
with l as (
  select il.id, il.invoice_id, i.invoice_number, i.invoice_date, i.supplier_id, s.name as supplier_name, il.description, il.supplier_sku,
         public.rm_match_key(il.description) as mk,
         coalesce(public.rm_sku_norm(il.supplier_sku), '') as norm,
         (s.name ~* '\masko\M' and coalesce(il.supplier_sku, '') ~ '^\d{3}\s*-\s*\d{1,2}(\s*/\s*\d{1,2})?$') as noise,
         il.requires_review, il.raw_material_id, i.status, i.flagged_at,
         exists(select 1 from public.invoice_internal_approvals a where a.invoice_id = i.id and a.status = 'approved' and a.revoked_at is null) as approved,
         exists(select 1 from public.invoice_line_cost_postings p where p.invoice_line_id = il.id and p.revoked_at is null) as posted,
         il.excluded_at
  from public.invoice_lines il
  join public.invoices i on i.id = il.invoice_id
  join public.suppliers s on s.id = i.supplier_id
  where i.legal_entity_id = p_legal_entity_id and il.description is not null and coalesce(il.line_kind, 'vare') = 'vare'
), cand as (
  select distinct supplier_id, mk, norm from l where norm <> '' and not noise and length(norm) >= 4
), canon as (
  select c.supplier_id, c.mk, c.norm as canonical
  from cand c
  where not exists (
    select 1 from cand o
    where o.supplier_id = c.supplier_id and o.mk = c.mk and o.norm <> c.norm
      and not (length(o.norm) < length(c.norm) and (right(c.norm, length(o.norm)) = o.norm or left(c.norm, length(o.norm)) = o.norm))
  )
)
select l.id, l.invoice_id, l.invoice_number, l.invoice_date, l.supplier_id, l.supplier_name, l.mk, l.description, l.supplier_sku, k.canonical,
  case when l.noise then 'ikke_varenummer' when l.norm = '' then 'manglet_varenummer'
       when right(k.canonical, length(l.norm)) = l.norm then 'avkortet_foran'
       when left(k.canonical, length(l.norm)) = l.norm then 'avkortet_bak' else 'annet' end,
  (l.requires_review is true and l.raw_material_id is null and l.excluded_at is null and not l.approved and not l.posted
     and l.status in ('imported', 'needs_review', 'ready') and l.flagged_at is null),
  case when l.approved then 'godkjent_internt' when l.posted then 'kost_fort' when l.excluded_at is not null then 'holdt_utenfor'
       when l.raw_material_id is not null then 'koblet' when l.requires_review is not true then 'ferdig'
       when l.status not in ('imported', 'needs_review', 'ready') or l.flagged_at is not null then 'faktura_lukket' end
from l join canon k on k.supplier_id = l.supplier_id and k.mk = l.mk
where l.norm is distinct from k.canonical
$$;

revoke all on function public._rm_sku_canon_plan(uuid) from public, anon, authenticated;
grant execute on function public._rm_sku_canon_plan(uuid) to service_role;

-- Lesbar forhåndsvisning for appen/godkjennere (lesetilgang til fakturaer kreves).
create or replace function public.rm_sku_canon_dryrun(p_legal_entity_id uuid)
returns table (
  line_id uuid, invoice_id uuid, invoice_number text, invoice_date date, supplier_id uuid, supplier_name text,
  match_key text, description text, current_sku text, proposed_sku text, reason text, can_change boolean, blocker text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Krever pålogging' using errcode = '28000'; end if;
  if not public.has_ravarer_invoice_access(p_legal_entity_id, 'read') then
    raise exception 'Mangler lesetilgang til fakturaer' using errcode = '42501';
  end if;
  return query select * from public._rm_sku_canon_plan(p_legal_entity_id);
end;
$$;

revoke all on function public.rm_sku_canon_dryrun(uuid) from public, anon;
grant execute on function public.rm_sku_canon_dryrun(uuid) to authenticated, service_role;

-- Linjeskift: limes filen inn med Windows-linjeskift (CR+LF), får funksjonene over et usynlig CR-tegn i kroppen.
-- Denne blokken skriver dem på nytt med bare LF, slik at kontrollsummene blir de samme uansett innliming.
-- Gjør ingenting når alt allerede er LF. Rører bare funksjonene denne filen oppretter.
do $lf$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = any (array['_rm_sku_canon_plan', 'rm_sku_canon_dryrun'])
              and p.prokind = 'f' and strpos(p.prosrc, chr(13)) > 0 loop
    execute replace(pg_get_functiondef(r.oid), chr(13), '');
  end loop;
end $lf$;
