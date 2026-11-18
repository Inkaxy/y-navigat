-- 20261124_raske_oppslag_del2_rls.PENDING.sql — IKKE KJØRT. Kjøres av root etter Henriks ja, ETTER del 1 (kan også kjøres alene).
--
-- HVA: radsikkerheten for LESING av invoices og invoice_lines regnes én gang per spørring i stedet for én gang per rad.
-- HVORFOR: i dag kaller policyen has_ravarer_invoice_read_or_owner(legal_entity_id) for hver rad, og invoice_lines-policyen
--  gjør i tillegg et oppslag i invoices per linje (som igjen har sin egen policy). Med 5 561 linjer blir det tusenvis av
--  tilgangskall per sidevisning. Dette rammer alle direkte lesinger (fakturalisten: snitt 2 351 ms over 1 997 kall;
--  tellingen av linjer til gjennomgang: snitt 1 776 ms over 2 364 kall) – også fra andre apper som deler databasen.
--
-- HVA SOM ENDRES (bare dette):
--  1. Ny hjelpefunksjon public.rm_invoice_read_entity_ids() → uuid[]: selskapene der innlogget bruker har
--     has_ravarer_invoice_read_or_owner(selskap) = true. Samme funksjon som i dag, bare spurt per selskap (1 selskap) i
--     stedet for per rad.
--  2. Policy invoices_select:      has_ravarer_invoice_read_or_owner(legal_entity_id)
--                              →   legal_entity_id in (select unnest(public.rm_invoice_read_entity_ids()))
--  3. Policy invoice_lines_select: exists (select 1 from invoices i where i.id = invoice_id and has_…(i.legal_entity_id))
--                              →   invoice_id in (select i.id from invoices i where i.legal_entity_id in (select unnest(public.rm_invoice_read_entity_ids())))
--  Samme svar for hver rad: has_…(x) er STABLE (samme bruker, samme dato i hele spørringen), og legal_entity_id er aldri
--  null (kontrollert 18.11: 0 rader; null gir «ingen tilgang» både før og etter).
--
-- HVA SOM IKKE ENDRES: skrive-policyene (insert/update/delete), tilgangsfunksjonene, tabeller, data, rettigheter.
-- Vakt: filen stopper hvis dagens policytekst ikke er nøyaktig den som ble lest 18.11.
-- TILBAKE: 20261124_raske_oppslag_del2_rls.check.sql har nederst de to CREATE POLICY-setningene som gjenoppretter dagens tekst.
begin;

do $$
declare q text;
begin
  if to_regprocedure('public.rm_invoice_read_entity_ids()') is not null then raise exception 'Del 2 er allerede kjørt (rm_invoice_read_entity_ids finnes).'; end if;
  select qual into q from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_select' and cmd = 'SELECT';
  if md5(q) is distinct from 'd3094b3319b46be45f7971f6302631a0' then raise exception 'invoices_select er endret siden 18.11: %', q; end if;
  select qual into q from pg_policies where schemaname = 'public' and tablename = 'invoice_lines' and policyname = 'invoice_lines_select' and cmd = 'SELECT';
  if md5(q) is distinct from 'd1ffa1e563ff2391ebfdd08b491299c1' then
    raise exception 'invoice_lines_select er endret siden 18.11: %', q; end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename in ('invoices','invoice_lines') and cmd in ('SELECT','ALL')) <> 2 then
    raise exception 'Uventet antall lesepolicyer på invoices/invoice_lines.'; end if;
end $$;

create function public.rm_invoice_read_entity_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(le.id order by le.id), '{}'::uuid[])
    from public.legal_entities le
   where public.has_ravarer_invoice_read_or_owner(le.id)
$$;
revoke all on function public.rm_invoice_read_entity_ids() from public, anon;
grant execute on function public.rm_invoice_read_entity_ids() to authenticated, service_role;

drop policy invoices_select on public.invoices;
create policy invoices_select on public.invoices for select
  using (legal_entity_id in (select unnest(public.rm_invoice_read_entity_ids())));

drop policy invoice_lines_select on public.invoice_lines;
create policy invoice_lines_select on public.invoice_lines for select
  using (invoice_id in (select i.id from public.invoices i where i.legal_entity_id in (select unnest(public.rm_invoice_read_entity_ids()))));

-- Linjeskift: limes filen inn med Windows-linjeskift (CR+LF), får funksjonene over et usynlig CR-tegn i kroppen.
-- Denne blokken skriver dem på nytt med bare LF, slik at kontrollsummene blir de samme uansett innliming.
-- Gjør ingenting når alt allerede er LF. Rører bare funksjonene denne filen oppretter.
do $lf$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = any (array['rm_invoice_read_entity_ids'])
              and p.prokind = 'f' and strpos(p.prosrc, chr(13)) > 0 loop
    execute replace(pg_get_functiondef(r.oid), chr(13), '');
  end loop;
end $lf$;

commit;
