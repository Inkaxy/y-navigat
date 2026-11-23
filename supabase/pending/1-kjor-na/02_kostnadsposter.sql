-- 02 Kostnadsposter (23.11.2026). Råvarer › Fakturaer › Kostnader og «Kostnadspost …» i Fra faktura › Nye varer.
-- Samler linjer som ikke er varer (frakt, miljøvederlag, gebyrer …) fra ulike fakturaer i egne poster, med sum per år,
-- per leverandør og per fakturalinje. Valget huskes per leverandør + fakturalinje (samme nøkkel som leverandørvaren),
-- så nye fakturaer telles med automatisk.
-- Endrer ingen eksisterende data: ingen fakturaer, linjer, varer, priser eller innstillinger røres.
-- Nytt:
--   * tabellene rm_cost_posts (postene) og rm_cost_post_rules (hvilken leverandørlinje som hører til hvilken post).
--     RLS: lesing for dem med fakturatilgang; ingen skriving fra klienten – bare via funksjonene under.
--   * rm_save_cost_post (opprett/gi nytt navn/arkiver), rm_set_cost_post_rule (legg i / ta ut av post),
--     rm_cost_post_summary (årsoversikt), rm_cost_post_lines (fakturalinjene bak en post), rm_cap_kostnadsposter_v1.
--   * Skriving krever skrivetilgang til fakturaer og føres i revisjonsloggen.
-- Kontroll: kontroll/20261128_kostnadsposter.check.sql
begin;

do $$
begin
  if to_regclass('public.rm_cost_posts') is not null or to_regclass('public.rm_cost_post_rules') is not null then
    raise exception 'Kostnadsposter finnes allerede – denne filen er kjørt før. Kjør den ikke på nytt.';
  end if;
end $$;

create table public.rm_cost_posts (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  name text not null,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
grant select on public.rm_cost_posts to authenticated;
grant all on public.rm_cost_posts to service_role;
alter table public.rm_cost_posts enable row level security;
create policy "Kostnadsposter: lesing med fakturatilgang" on public.rm_cost_posts
  for select to authenticated using (public.has_ravarer_invoice_access(legal_entity_id, 'read'));
create unique index rm_cost_posts_active_name_uq on public.rm_cost_posts (legal_entity_id, lower(btrim(name))) where archived_at is null;

create table public.rm_cost_post_rules (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  cost_post_id uuid not null references public.rm_cost_posts(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  item_key text not null,
  example_text text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint rm_cost_post_rules_item_uq unique (legal_entity_id, supplier_id, item_key)
);
grant select on public.rm_cost_post_rules to authenticated;
grant all on public.rm_cost_post_rules to service_role;
alter table public.rm_cost_post_rules enable row level security;
create policy "Kostnadspostregler: lesing med fakturatilgang" on public.rm_cost_post_rules
  for select to authenticated using (public.has_ravarer_invoice_access(legal_entity_id, 'read'));
create index rm_cost_post_rules_post_idx on public.rm_cost_post_rules (cost_post_id);

-- Leverandørlinjens nøkkel: nøyaktig samme uttrykk som rm_supplier_items (sku:… ellers name:…).
create or replace function public._rm_cost_item_key(p_sku text, p_description text)
 returns text language sql immutable set search_path to 'public'
as $function$
  select case when public.rm_sku_norm(p_sku) <> '' then 'sku:' || public.rm_sku_norm(p_sku)
              else 'name:' || public.rm_match_key(p_description) end
$function$;

create or replace function public.rm_save_cost_post(p_legal_entity_id uuid, p_id uuid, p_name text, p_archived boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_row public.rm_cost_posts%rowtype;
  v_before jsonb;
begin
  if not public.has_ravarer_invoice_access(p_legal_entity_id, 'write') then
    raise exception 'Ingen skrivetilgang til fakturaer for dette selskapet' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    return jsonb_build_object('ok', false, 'code', 'ugyldig_navn');
  end if;
  perform pg_advisory_xact_lock(hashtext('rm_cost_posts:' || p_legal_entity_id::text));
  if p_id is null then
    select * into v_row from public.rm_cost_posts
     where legal_entity_id = p_legal_entity_id and archived_at is null and lower(btrim(name)) = lower(v_name);
    if found then
      return jsonb_build_object('ok', true, 'id', v_row.id, 'name', v_row.name, 'existed', true);
    end if;
    insert into public.rm_cost_posts (legal_entity_id, name, created_by, updated_by)
    values (p_legal_entity_id, v_name, v_uid, v_uid) returning * into v_row;
    insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
    values (v_uid, 'cost_post.created', 'rm_cost_posts', v_row.id, p_legal_entity_id, jsonb_build_object('name', v_row.name), null, 'ravarer');
    return jsonb_build_object('ok', true, 'id', v_row.id, 'name', v_row.name, 'existed', false);
  end if;
  select * into v_row from public.rm_cost_posts where id = p_id and legal_entity_id = p_legal_entity_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'finnes_ikke');
  end if;
  if not coalesce(p_archived, false) and exists (
       select 1 from public.rm_cost_posts where legal_entity_id = p_legal_entity_id and archived_at is null
          and id <> p_id and lower(btrim(name)) = lower(v_name)) then
    return jsonb_build_object('ok', false, 'code', 'navn_finnes');
  end if;
  v_before := jsonb_build_object('name', v_row.name, 'archived', v_row.archived_at is not null);
  update public.rm_cost_posts
     set name = v_name,
         archived_at = case when coalesce(p_archived, false) then coalesce(archived_at, now()) else null end,
         updated_by = v_uid, updated_at = now()
   where id = p_id returning * into v_row;
  insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'cost_post.updated', 'rm_cost_posts', v_row.id, p_legal_entity_id,
    jsonb_build_object('before', v_before, 'after', jsonb_build_object('name', v_row.name, 'archived', v_row.archived_at is not null)), null, 'ravarer');
  return jsonb_build_object('ok', true, 'id', v_row.id, 'name', v_row.name, 'archived', v_row.archived_at is not null);
end $function$;

-- Legg en leverandørlinje i en post (p_cost_post_id) eller ta den ut (null). Gjelder alle fakturaer, også nye.
create or replace function public.rm_set_cost_post_rule(p_legal_entity_id uuid, p_supplier_id uuid, p_item_key text, p_cost_post_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_prev uuid;
  v_example text;
  v_post public.rm_cost_posts%rowtype;
begin
  if not public.has_ravarer_invoice_access(p_legal_entity_id, 'write') then
    raise exception 'Ingen skrivetilgang til fakturaer for dette selskapet' using errcode = '42501';
  end if;
  if p_supplier_id is null or p_item_key is null or p_item_key !~ '^(sku|name):.+' then
    return jsonb_build_object('ok', false, 'code', 'ugyldig');
  end if;
  -- Leverandørlinjen må finnes på selskapets fakturaer.
  select il.description into v_example
    from public.invoice_lines il join public.invoices i on i.id = il.invoice_id
   where i.legal_entity_id = p_legal_entity_id and i.supplier_id = p_supplier_id
     and public._rm_cost_item_key(il.supplier_sku, il.description) = p_item_key
   order by i.invoice_date desc nulls last, il.created_at desc limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'ukjent_linje');
  end if;
  if p_cost_post_id is not null then
    select * into v_post from public.rm_cost_posts where id = p_cost_post_id and legal_entity_id = p_legal_entity_id;
    if not found or v_post.archived_at is not null then
      return jsonb_build_object('ok', false, 'code', 'ukjent_post');
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('rm_cost_post_rules:' || p_legal_entity_id::text || ':' || p_supplier_id::text || ':' || p_item_key));
  select cost_post_id into v_prev from public.rm_cost_post_rules
   where legal_entity_id = p_legal_entity_id and supplier_id = p_supplier_id and item_key = p_item_key;
  if p_cost_post_id is null then
    delete from public.rm_cost_post_rules where legal_entity_id = p_legal_entity_id and supplier_id = p_supplier_id and item_key = p_item_key;
  else
    insert into public.rm_cost_post_rules (legal_entity_id, cost_post_id, supplier_id, item_key, example_text, created_by)
    values (p_legal_entity_id, p_cost_post_id, p_supplier_id, p_item_key, v_example, v_uid)
    on conflict on constraint rm_cost_post_rules_item_uq do update
      set cost_post_id = excluded.cost_post_id, example_text = excluded.example_text, created_by = excluded.created_by, created_at = now();
  end if;
  if v_prev is distinct from p_cost_post_id then
    insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
    values (v_uid, 'cost_post.rule_set', 'rm_cost_post_rules', coalesce(p_cost_post_id, v_prev), p_legal_entity_id,
      jsonb_build_object('supplier_id', p_supplier_id, 'item_key', p_item_key, 'before', v_prev, 'after', p_cost_post_id), null, 'ravarer');
  end if;
  return jsonb_build_object('ok', true, 'cost_post_id', p_cost_post_id, 'previous_post_id', v_prev, 'changed', v_prev is distinct from p_cost_post_id);
end $function$;

-- Årsoversikt: per post sum, antall linjer/fakturaer, per leverandør og per leverandørlinje. Linjer som leseren merket
-- som frakt/gebyr/pant/annet uten post kommer som forslag. Ukjent beløp telles for seg (aldri som 0).
create or replace function public.rm_cost_post_summary(p_legal_entity_id uuid, p_year integer)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_from date;
  v_to date;
  v_posts jsonb;
  v_suggest jsonb;
  v_invoices int;
  v_unread int;
begin
  if not public.has_ravarer_invoice_access(p_legal_entity_id, 'read') then
    raise exception 'Ingen fakturatilgang for dette selskapet' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then
    return jsonb_build_object('ok', false, 'code', 'ugyldig_aar');
  end if;
  v_from := make_date(p_year, 1, 1);
  v_to := make_date(p_year + 1, 1, 1);

  select count(*), count(*) filter (where coalesce(i.line_extraction_status, '') in ('pending', 'processing', 'failed'))
    into v_invoices, v_unread
    from public.invoices i
   where i.legal_entity_id = p_legal_entity_id and i.invoice_date >= v_from and i.invoice_date < v_to
     and i.excluded_at is null and i.status is distinct from 'excluded';

  with ln as materialized (
    select il.id, il.invoice_id, i.supplier_id, il.description, il.line_kind, il.total_amount,
           public._rm_cost_item_key(il.supplier_sku, il.description) item_key, i.invoice_date
      from public.invoice_lines il
      join public.invoices i on i.id = il.invoice_id
     where i.legal_entity_id = p_legal_entity_id and i.invoice_date >= v_from and i.invoice_date < v_to
       and i.excluded_at is null and i.status is distinct from 'excluded'
  ), ruled as materialized (
    select ln.*, r.cost_post_id from ln
      join public.rm_cost_post_rules r on r.legal_entity_id = p_legal_entity_id and r.supplier_id = ln.supplier_id and r.item_key = ln.item_key
  ), per_supplier as (
    select cost_post_id, supplier_id, sum(total_amount) amount, count(*) lines, count(*) filter (where total_amount is null) missing
      from ruled group by 1, 2
  ), per_item as (
    select cost_post_id, supplier_id, item_key, (array_agg(description order by invoice_date desc, id desc))[1] example,
           sum(total_amount) amount, count(*) lines, count(*) filter (where total_amount is null) missing, max(invoice_date) last_date
      from ruled group by 1, 2, 3
  ), rules as (
    select r.cost_post_id, r.supplier_id, r.item_key, r.example_text from public.rm_cost_post_rules r where r.legal_entity_id = p_legal_entity_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.name, 'archived', p.archived_at is not null,
           'amount', (select sum(total_amount) from ruled where cost_post_id = p.id),
           'lines', (select count(*) from ruled where cost_post_id = p.id),
           'invoices', (select count(distinct invoice_id) from ruled where cost_post_id = p.id),
           'missing_amount', (select count(*) from ruled where cost_post_id = p.id and total_amount is null),
           'suppliers', coalesce((select jsonb_agg(jsonb_build_object('supplier_id', s.supplier_id, 'name', sp.name, 'amount', s.amount, 'lines', s.lines, 'missing_amount', s.missing)
                                    order by s.amount desc nulls last, sp.name)
                                    from per_supplier s left join public.suppliers sp on sp.id = s.supplier_id where s.cost_post_id = p.id), '[]'::jsonb),
           'items', coalesce((select jsonb_agg(jsonb_build_object('supplier_id', r.supplier_id, 'supplier_name', sp.name, 'item_key', r.item_key,
                                    'text', coalesce(pi.example, r.example_text), 'amount', pi.amount, 'lines', coalesce(pi.lines, 0),
                                    'missing_amount', coalesce(pi.missing, 0), 'last_date', pi.last_date)
                                    order by pi.amount desc nulls last, sp.name, r.item_key)
                                    from rules r left join per_item pi on pi.cost_post_id = r.cost_post_id and pi.supplier_id = r.supplier_id and pi.item_key = r.item_key
                                    left join public.suppliers sp on sp.id = r.supplier_id where r.cost_post_id = p.id), '[]'::jsonb)
         ) order by p.archived_at is not null, lower(p.name)), '[]'::jsonb)
    into v_posts
    from public.rm_cost_posts p
   where p.legal_entity_id = p_legal_entity_id
     and (p.archived_at is null or exists (select 1 from ruled where cost_post_id = p.id));

  with ln as (
    select i.supplier_id, il.description, il.line_kind, il.total_amount, i.invoice_date, il.id,
           public._rm_cost_item_key(il.supplier_sku, il.description) item_key
      from public.invoice_lines il
      join public.invoices i on i.id = il.invoice_id
     where i.legal_entity_id = p_legal_entity_id and i.invoice_date >= v_from and i.invoice_date < v_to
       and i.excluded_at is null and i.status is distinct from 'excluded'
       and il.line_kind in ('frakt', 'gebyr', 'pant', 'annet')
  ), g as (
    select ln.supplier_id, ln.item_key, (array_agg(ln.description order by ln.invoice_date desc, ln.id desc))[1] example,
           (array_agg(ln.line_kind order by ln.invoice_date desc, ln.id desc))[1] line_kind,
           sum(ln.total_amount) amount, count(*) lines, count(*) filter (where ln.total_amount is null) missing
      from ln
     where not exists (select 1 from public.rm_cost_post_rules r where r.legal_entity_id = p_legal_entity_id and r.supplier_id = ln.supplier_id and r.item_key = ln.item_key)
     group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object('supplier_id', g.supplier_id, 'supplier_name', sp.name, 'item_key', g.item_key, 'text', g.example,
           'line_kind', g.line_kind, 'amount', g.amount, 'lines', g.lines, 'missing_amount', g.missing)
           order by g.amount desc nulls last, sp.name, g.item_key), '[]'::jsonb)
    into v_suggest
    from (select * from g order by amount desc nulls last limit 100) g left join public.suppliers sp on sp.id = g.supplier_id;

  return jsonb_build_object('ok', true, 'year', p_year, 'invoices', v_invoices, 'unread_invoices', v_unread,
    'posts', v_posts, 'suggestions', v_suggest);
end $function$;

-- Fakturalinjene bak én post i et år (valgfritt én leverandør). Høyst 2 000 linjer; 'total' er det faktiske antallet.
create or replace function public.rm_cost_post_lines(p_legal_entity_id uuid, p_cost_post_id uuid, p_year integer, p_supplier_id uuid default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_lines jsonb;
  v_total int;
begin
  if not public.has_ravarer_invoice_access(p_legal_entity_id, 'read') then
    raise exception 'Ingen fakturatilgang for dette selskapet' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 or p_cost_post_id is null then
    return jsonb_build_object('ok', false, 'code', 'ugyldig');
  end if;
  if not exists (select 1 from public.rm_cost_posts where id = p_cost_post_id and legal_entity_id = p_legal_entity_id) then
    return jsonb_build_object('ok', false, 'code', 'ukjent_post');
  end if;
  with ln as materialized (
    select il.id, il.invoice_id, i.invoice_number, i.invoice_date, i.is_credit_note, i.supplier_id, sp.name supplier_name,
           il.description, il.quantity, il.unit, il.unit_price, il.total_amount
      from public.invoice_lines il
      join public.invoices i on i.id = il.invoice_id
      join public.rm_cost_post_rules r on r.legal_entity_id = p_legal_entity_id and r.supplier_id = i.supplier_id
                                     and r.item_key = public._rm_cost_item_key(il.supplier_sku, il.description)
      left join public.suppliers sp on sp.id = i.supplier_id
     where r.cost_post_id = p_cost_post_id and i.legal_entity_id = p_legal_entity_id
       and i.invoice_date >= make_date(p_year, 1, 1) and i.invoice_date < make_date(p_year + 1, 1, 1)
       and i.excluded_at is null and i.status is distinct from 'excluded'
       and (p_supplier_id is null or i.supplier_id = p_supplier_id)
  )
  select (select count(*) from ln),
         coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'invoice_id', x.invoice_id, 'invoice_number', x.invoice_number,
                    'invoice_date', x.invoice_date, 'is_credit_note', coalesce(x.is_credit_note, false), 'supplier_id', x.supplier_id,
                    'supplier_name', x.supplier_name, 'text', x.description, 'quantity', x.quantity, 'unit', x.unit,
                    'unit_price', x.unit_price, 'amount', x.total_amount) order by x.invoice_date desc, x.id)
                   from (select * from ln order by invoice_date desc, id limit 2000) x), '[]'::jsonb)
    into v_total, v_lines;
  return jsonb_build_object('ok', true, 'total', v_total, 'lines', v_lines);
end $function$;

create or replace function public.rm_cap_kostnadsposter_v1() returns boolean language sql stable set search_path = public as $$ select true $$;

revoke all on function public._rm_cost_item_key(text, text) from public, anon;
revoke all on function public.rm_save_cost_post(uuid, uuid, text, boolean) from public, anon;
revoke all on function public.rm_set_cost_post_rule(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.rm_cost_post_summary(uuid, integer) from public, anon;
revoke all on function public.rm_cost_post_lines(uuid, uuid, integer, uuid) from public, anon;
revoke all on function public.rm_cap_kostnadsposter_v1() from public, anon;
grant execute on function public._rm_cost_item_key(text, text) to authenticated, service_role;
grant execute on function public.rm_save_cost_post(uuid, uuid, text, boolean) to authenticated, service_role;
grant execute on function public.rm_set_cost_post_rule(uuid, uuid, text, uuid) to authenticated, service_role;
grant execute on function public.rm_cost_post_summary(uuid, integer) to authenticated, service_role;
grant execute on function public.rm_cost_post_lines(uuid, uuid, integer, uuid) to authenticated, service_role;
grant execute on function public.rm_cap_kostnadsposter_v1() to authenticated, service_role;

notify pgrst, 'reload schema';
-- Linjeskift: limes filen inn med Windows-linjeskift (CR+LF), får funksjonene over et usynlig CR-tegn i kroppen.
-- Denne blokken skriver dem på nytt med bare LF. Gjør ingenting når alt allerede er LF. Rører bare funksjonene over.
do $lf$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname = any (array['_rm_cost_item_key', 'rm_save_cost_post', 'rm_set_cost_post_rule', 'rm_cost_post_summary',
                                         'rm_cost_post_lines', 'rm_cap_kostnadsposter_v1'])
              and p.prokind = 'f' and strpos(p.prosrc, chr(13)) > 0 loop
    execute replace(pg_get_functiondef(r.oid), chr(13), '');
  end loop;
end $lf$;

commit;
