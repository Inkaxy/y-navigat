-- 01_nullstill_koen.sql — IKKE KJØRT. Kjøres av root/Henrik i SQL Editor etter Henriks ja. Bestilling 18.11.2026 «Nullstill køen».
--
-- HVA FILEN GJØR: legger bare til det appen trenger for å KJØRE nullstillingen. Filen starter ingen kjøring, endrer ingen
-- fakturalinjer, ingen kostpriser og ingen innstillinger. Selve kjøringen startes av Henrik under Fra faktura › «Nullstill køen …».
--
--  1. «Hold utenfor» får egen kategori 'nullstilling' (bare for én linje): constraint på invoice_lines.exclusion_category utvides,
--     og rm_set_invoice_exclusion (live md5 b4f626aa2d2de03174c910e64317519d) får ett eksakt tekstbytte. Alt annet i funksjonen er
--     uendret (versjon, op-id, sperrer, revisjonslogg, ingen prisobservasjon).
--  2. Nye tabeller (bare for kjøringen): rm_queue_reset_runs (kjøringer), rm_queue_reset_snapshot (linjene i forhåndsvisningen),
--     rm_queue_reset_items (ett steg per leverandørvare/linje), rm_queue_reset_item_lines (én linje høyst én gang per fase).
--     Lesing med fakturalesetilgang (RLS), ingen direkte skriving – bare via funksjonene under.
--  3. Funksjoner (godkjenner/admin + skrivetilgang): rm_queue_reset_snapshot_lines, rm_queue_reset_catalog, rm_queue_reset_start,
--     rm_queue_reset_add_phase2, rm_queue_reset_claim, rm_queue_reset_finish, rm_queue_reset_recover, rm_queue_reset_check,
--     rm_queue_reset_set_status, rm_queue_reset_complete, rm_queue_reset_set_limit, rm_queue_reset_undo_mark;
--     lesing: rm_queue_reset_status; markør rm_cap_nullstill_koen_v1().
--     Selve handlingene gjøres av appen med de SAMME funksjonene som knappene i Fra faktura: link-supplier-item
--     (rm_link_supplier_item), rm_remember_supplier_item_names, rm_supplier_item_accept_price og rm_set_invoice_exclusion.
--  4. rm_queue_reset_complete setter grensen for prishopp til 1 % via rm_set_fra_faktura_settings (live md5
--     809457c5c22c32cce357d535e1248f2d) bare når kjøringen er ferdig uten feilede steg, og legger fakturaene i omregningskøen
--     (rm_rematch_invoices) slik at de får status etter dagens regler. Ingen avstemming, ingen godkjenning.
--     Bryteren «prisendringer under grensen føres uten spørsmål» endres ALDRI av filen eller kjøringen.
--
-- Kontroll: kontroll/20261124_nullstill_koen.check.sql (før/etter + md5). Lokal test: node scripts/test-nullstilling-sql.mjs
-- Innliming: tåler Windows-linjeskift – ankeret renses for CR/hardt mellomrom/tabulator før det sammenlignes med uendret
-- live-tekst, md5 regnes uten CR, og sluttsteget nederst skriver funksjonene på nytt uten CR.
begin;

do $g$
declare d text;
begin
  if to_regprocedure('public.rm_cap_nullstill_koen_v1()') is not null then raise exception 'Filen er allerede kjørt (rm_cap_nullstill_koen_v1 finnes).'; end if;
  d := replace(pg_get_functiondef('public.rm_set_invoice_exclusion(uuid,text,uuid,text,text,text,uuid)'::regprocedure), chr(13), '');
  if md5(d) <> 'b4f626aa2d2de03174c910e64317519d' then raise exception 'rm_set_invoice_exclusion er endret siden 18.11 (md5 %)', md5(d); end if;
  d := replace(pg_get_functiondef('public.rm_set_fra_faktura_settings(uuid,numeric,boolean,boolean)'::regprocedure), chr(13), '');
  if md5(d) <> '809457c5c22c32cce357d535e1248f2d' then raise exception 'rm_set_fra_faktura_settings er endret siden 18.11 (md5 %)', md5(d); end if;
  d := replace(pg_get_functiondef('public.rm_fra_faktura_settings(uuid)'::regprocedure), chr(13), '');
  if md5(d) <> '8ff7969936cbd373012e34dc11398489' then raise exception 'rm_fra_faktura_settings er endret siden 18.11 (md5 %)', md5(d); end if;
  if to_regprocedure('public.rm_link_supplier_item(uuid,uuid,text,uuid,jsonb,jsonb,boolean,boolean,text,uuid[])') is null
     or to_regprocedure('public.rm_supplier_item_accept_price(uuid,uuid,text,jsonb,text)') is null
     or to_regprocedure('public.rm_undo_supplier_item_link(uuid,uuid,text,uuid[],uuid,boolean,text)') is null
     or to_regprocedure('public.rm_undo_not_item(uuid,uuid,text,uuid[],boolean,text)') is null
     or to_regprocedure('public.rm_undo_price_acceptance(uuid,uuid[],text)') is null
     or to_regprocedure('public.rm_reopen_invoice_exclusion(uuid,text,uuid,text,text)') is null
     or to_regprocedure('public.rm_rematch_invoices(uuid,integer,uuid[],boolean)') is null
     or to_regprocedure('public._rm_queue_line_read_issue(uuid,boolean)') is null
     or to_regprocedure('public.rm_invoice_has_read_issues(uuid)') is null
     or to_regprocedure('public._rm_line_exclusion_blocker(uuid)') is null then
    raise exception 'En funksjon nullstillingen bygger på mangler i databasen.';
  end if;
end $g$;

-- 1 Egen kategori for «Avsluttet ved nullstilling» ----------------------------------------------------------------------
alter table public.invoice_lines drop constraint if exists invoice_lines_exclusion_category_check;
alter table public.invoice_lines add constraint invoice_lines_exclusion_category_check
  check (exclusion_category is null or exclusion_category = any (array['erstatning_produksjonstap'::text, 'annet'::text, 'nullstilling'::text]));

do $x$
declare d text; s_old text; s_new text;
begin
  d := replace(pg_get_functiondef('public.rm_set_invoice_exclusion(uuid,text,uuid,text,text,text,uuid)'::regprocedure), chr(13), '');
  s_old := $a$  if p_category not in ('erstatning_produksjonstap','annet') then return jsonb_build_object('ok', false, 'error', 'ugyldig_arsak'); end if;$a$;
  s_new := $a$  if p_category not in ('erstatning_produksjonstap','annet','nullstilling') then return jsonb_build_object('ok', false, 'error', 'ugyldig_arsak'); end if;
  if p_category = 'nullstilling' and p_scope <> 'line' then return jsonb_build_object('ok', false, 'error', 'ugyldig_arsak'); end if;$a$;
  s_old := replace(replace(replace(s_old, chr(13), ''), chr(160), ' '), chr(9), ' '); s_new := replace(replace(replace(s_new, chr(13), ''), chr(160), ' '), chr(9), ' ');
  if (length(d) - length(replace(d, s_old, ''))) <> length(s_old) then raise exception 'anker a (kategori) finnes ikke nøyaktig én gang'; end if;
  execute replace(d, s_old, s_new);
end $x$;

-- 2 Tabeller --------------------------------------------------------------------------------------------------------------
create table public.rm_queue_reset_runs (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null,
  label text not null default 'Nullstilling 18.11.2026',
  status text not null default 'aktiv' check (status in ('aktiv','pause','stoppet','ferdig')),
  phase smallint not null default 1 check (phase in (1, 2)),
  fingerprint text not null,
  plan_summary jsonb not null default '{}'::jsonb,
  snapshot_count integer not null,
  settings_before jsonb,
  price_jump_set_at timestamptz,
  rematch jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  finished_by uuid,
  updated_at timestamptz not null default now()
);
create unique index rm_queue_reset_runs_one_active on public.rm_queue_reset_runs (legal_entity_id) where status in ('aktiv','pause');

create table public.rm_queue_reset_snapshot (
  run_id uuid not null references public.rm_queue_reset_runs(id) on delete cascade,
  line_id uuid not null,
  invoice_id uuid not null,
  primary key (run_id, line_id)
);

create table public.rm_queue_reset_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.rm_queue_reset_runs(id) on delete cascade,
  legal_entity_id uuid not null,
  phase smallint not null check (phase in (1, 2)),
  seq integer not null,
  rule smallint not null check (rule in (1, 2, 3, 4, 6)),
  action text not null check (action in ('ikke_vare','godta_pris','bekreft_pakning','koble','opprett','hold_utenfor')),
  supplier_id uuid,
  item_key text,
  raw_material_id uuid,
  line_ids uuid[] not null,
  payload jsonb not null default '{}'::jsonb,
  reason_code text,
  status text not null default 'venter' check (status in ('venter','pagar','ferdig','feilet','uavklart','hoppet_over')),
  op_id uuid not null default gen_random_uuid(),
  claim_token uuid,
  claimed_at timestamptz,
  attempts integer not null default 0,
  result jsonb,
  error text,
  finished_at timestamptz,
  created_raw_material_id uuid,
  undo_status text check (undo_status in ('angret','delvis','kan_ikke')),
  undo_result jsonb,
  undone_at timestamptz,
  undone_by uuid,
  updated_at timestamptz not null default now(),
  unique (run_id, phase, seq)
);
create index rm_queue_reset_items_run_status on public.rm_queue_reset_items (run_id, phase, status, seq);

create table public.rm_queue_reset_item_lines (
  run_id uuid not null references public.rm_queue_reset_runs(id) on delete cascade,
  phase smallint not null,
  line_id uuid not null,
  item_id uuid not null references public.rm_queue_reset_items(id) on delete cascade,
  primary key (run_id, phase, line_id)
);
create index rm_queue_reset_item_lines_line on public.rm_queue_reset_item_lines (line_id);

grant select on public.rm_queue_reset_runs, public.rm_queue_reset_snapshot, public.rm_queue_reset_items, public.rm_queue_reset_item_lines to authenticated;
grant all on public.rm_queue_reset_runs, public.rm_queue_reset_snapshot, public.rm_queue_reset_items, public.rm_queue_reset_item_lines to service_role;
alter table public.rm_queue_reset_runs enable row level security;
alter table public.rm_queue_reset_snapshot enable row level security;
alter table public.rm_queue_reset_items enable row level security;
alter table public.rm_queue_reset_item_lines enable row level security;
create policy rm_queue_reset_runs_read on public.rm_queue_reset_runs for select to authenticated
  using (public.has_ravarer_invoice_access(legal_entity_id, 'read'));
create policy rm_queue_reset_items_read on public.rm_queue_reset_items for select to authenticated
  using (public.has_ravarer_invoice_access(legal_entity_id, 'read'));
create policy rm_queue_reset_snapshot_read on public.rm_queue_reset_snapshot for select to authenticated
  using (exists (select 1 from public.rm_queue_reset_runs r where r.id = run_id and public.has_ravarer_invoice_access(r.legal_entity_id, 'read')));
create policy rm_queue_reset_item_lines_read on public.rm_queue_reset_item_lines for select to authenticated
  using (exists (select 1 from public.rm_queue_reset_runs r where r.id = run_id and public.has_ravarer_invoice_access(r.legal_entity_id, 'read')));

-- 3 Hjelpere (ikke kallbare fra klient) --------------------------------------------------------------------------------
create or replace function public._rm_qr_guard(p_le uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'ikke_innlogget' using errcode = '28000'; end if;
  if not coalesce(public.has_ravarer_invoice_approve(p_le), false) or not coalesce(public.has_ravarer_invoice_access(p_le, 'write'), false) then
    raise exception 'krever_godkjenner' using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function public._rm_qr_item_key(p_sku text, p_desc text)
returns text language sql stable security definer set search_path = public as $$
  select case when public.rm_sku_norm(p_sku) <> '' then 'sku:' || public.rm_sku_norm(p_sku) else 'name:' || public.rm_match_key(p_desc) end
$$;

create or replace function public._rm_qr_line_open(p_line_id uuid, p_le uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from invoice_lines il join invoices i on i.id = il.invoice_id
                  where il.id = p_line_id and i.legal_entity_id = p_le and i.status in ('imported','needs_review','ready')
                    and i.flagged_at is null and il.requires_review is true and il.excluded_at is null)
$$;

create or replace function public._rm_qr_insert_items(p_run uuid, p_le uuid, p_phase smallint, p_items jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_it jsonb; v_ord bigint; v_rule int; v_action text; v_lines uuid[]; v_sup uuid; v_key text; v_rm uuid; v_id uuid; v_n int := 0; v_bad int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'ugyldige_steg' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 10000 then raise exception 'for_mange_steg' using errcode = '22023'; end if;
  for v_it, v_ord in select e, o from jsonb_array_elements(p_items) with ordinality as t(e, o) loop
    v_rule := (v_it->>'rule')::int; v_action := v_it->>'action';
    if not ((v_rule = 1 and v_action = 'ikke_vare') or (v_rule = 2 and v_action = 'godta_pris') or (v_rule = 3 and v_action = 'bekreft_pakning')
         or (v_rule = 4 and v_action in ('koble','opprett')) or (v_rule = 6 and v_action = 'hold_utenfor')) then
      raise exception 'ugyldig_regel (steg %)', v_ord using errcode = '22023';
    end if;
    if (p_phase = 1 and v_rule not in (1, 2, 3, 4)) or (p_phase = 2 and v_rule not in (2, 6)) then
      raise exception 'regel_ikke_i_fasen (steg %)', v_ord using errcode = '22023';
    end if;
    if jsonb_typeof(v_it->'line_ids') is distinct from 'array' then raise exception 'ugyldig_linjeutvalg (steg %)', v_ord using errcode = '22023'; end if;
    select coalesce(array_agg(x::uuid order by o), '{}') into v_lines from jsonb_array_elements_text(v_it->'line_ids') with ordinality as t(x, o);
    if cardinality(v_lines) = 0 or cardinality(v_lines) > 2000 or (v_action = 'hold_utenfor' and cardinality(v_lines) <> 1) then
      raise exception 'ugyldig_linjeutvalg (steg %)', v_ord using errcode = '22023';
    end if;
    if length(coalesce(v_it->'payload', '{}'::jsonb)::text) > 20000 then raise exception 'for_stort_steg (steg %)', v_ord using errcode = '22023'; end if;
    select count(*) into v_bad from unnest(v_lines) x where not exists (select 1 from rm_queue_reset_snapshot s where s.run_id = p_run and s.line_id = x);
    if v_bad > 0 then raise exception 'linje_utenfor_utvalget (steg %)', v_ord using errcode = '22023'; end if;
    v_sup := nullif(v_it->>'supplier_id', '')::uuid; v_key := nullif(v_it->>'item_key', ''); v_rm := nullif(v_it->>'raw_material_id', '')::uuid;
    if v_action <> 'hold_utenfor' then
      if v_sup is null or v_key is null or v_key !~ '^(sku|name):' then raise exception 'mangler_leverandorvare (steg %)', v_ord using errcode = '22023'; end if;
      select count(*) into v_bad from invoice_lines il join invoices i on i.id = il.invoice_id
       where il.id = any(v_lines) and (i.supplier_id is distinct from v_sup or public._rm_qr_item_key(il.supplier_sku, il.description) is distinct from v_key);
      if v_bad > 0 then raise exception 'linje_feil_leverandorvare (steg %)', v_ord using errcode = '22023'; end if;
    end if;
    if v_action in ('bekreft_pakning', 'koble') and (v_rm is null or not exists (select 1 from raw_materials where id = v_rm and legal_entity_id = p_le)) then
      raise exception 'ugyldig_vare (steg %)', v_ord using errcode = '22023';
    end if;
    if v_action = 'bekreft_pakning' and exists (select 1 from invoice_lines il where il.id = any(v_lines) and il.raw_material_id is distinct from v_rm) then
      raise exception 'linje_ikke_koblet_til_varen (steg %)', v_ord using errcode = '22023';
    end if;
    if v_action = 'opprett' and (v_rm is not null or coalesce(btrim(v_it->'payload'->'new_raw_material'->>'name'), '') = '') then
      raise exception 'ny_vare_mangler_navn (steg %)', v_ord using errcode = '22023';
    end if;
    insert into rm_queue_reset_items (run_id, legal_entity_id, phase, seq, rule, action, supplier_id, item_key, raw_material_id, line_ids, payload, reason_code)
    values (p_run, p_le, p_phase, v_ord::int, v_rule, v_action, v_sup, v_key, v_rm, v_lines, coalesce(v_it->'payload', '{}'::jsonb), left(nullif(v_it->>'reason_code', ''), 60))
    returning id into v_id;
    -- Primærnøkkelen (kjøring, fase, linje) stopper hele forespørselen hvis en linje står i to steg.
    insert into rm_queue_reset_item_lines (run_id, phase, line_id, item_id) select p_run, p_phase, x, v_id from unnest(v_lines) x;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function public._rm_qr_guard(uuid), public._rm_qr_item_key(text, text), public._rm_qr_line_open(uuid, uuid),
  public._rm_qr_insert_items(uuid, uuid, smallint, jsonb) from public, anon, authenticated;
grant execute on function public._rm_qr_guard(uuid), public._rm_qr_item_key(text, text), public._rm_qr_line_open(uuid, uuid),
  public._rm_qr_insert_items(uuid, uuid, smallint, jsonb) to service_role;

-- 4 Forhåndsvisning (bare lesing) ---------------------------------------------------------------------------------------
-- Åpne linjer på åpne, ikke-flaggede fakturaer (requires_review), i sider på id. Varenøkkel og lesekontroll regnes av databasen.
create or replace function public.rm_queue_reset_snapshot_lines(p_legal_entity_id uuid, p_after uuid default null, p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_n int; v_lim int := greatest(1, least(coalesce(p_limit, 500), 1000));
begin
  perform public._rm_qr_guard(p_legal_entity_id);
  select coalesce(jsonb_agg(to_jsonb(b) order by b.line_id), '[]'::jsonb), count(*) into v_rows, v_n from (
    select il.id as line_id, il.invoice_id, i.invoice_number, i.invoice_date, i.supplier_id, s.name as supplier_name,
           i.lines_sum_status, coalesce(i.is_credit_note, false) as is_credit_note,
           exists (select 1 from invoice_internal_approvals a where a.invoice_id = i.id and a.status = 'approved' and a.revoked_at is null) as approved,
           exists (select 1 from invoice_line_cost_postings p where p.invoice_line_id = il.id and p.revoked_at is null) as cost_posted,
           public._rm_qr_item_key(il.supplier_sku, il.description) as item_key,
           il.supplier_sku, il.description, il.quantity, il.unit, il.unit_price, il.total_amount, il.discount_amount, il.unit_price_basis,
           il.line_kind,
           case when jsonb_typeof(il.extraction_issues) = 'array' and jsonb_array_length(il.extraction_issues) > 0
                then jsonb_build_array(il.extraction_issues->0) else '[]'::jsonb end as extraction_issues,
           il.package_size, il.package_unit, il.count_per_package, il.raw_material_id, il.match_confidence::text as match_confidence,
           il.review_reason, il.price_per_base_unit, il.expected_price_per_base_unit, il.price_variance_pct,
           il.updated_at::text as line_updated_at,
           public._rm_queue_line_read_issue(il.id, public.rm_invoice_has_read_issues(i.id)) as read_issue,
           public._rm_line_exclusion_blocker(il.id) as exclusion_blocker,
           rm.name as rm_name, rm.base_unit as rm_base_unit, rm.current_cost_price as rm_cost, coalesce(rm.is_active, true) as rm_active
      from invoice_lines il
      join invoices i on i.id = il.invoice_id
      left join suppliers s on s.id = i.supplier_id
      left join raw_materials rm on rm.id = il.raw_material_id
     where i.legal_entity_id = p_legal_entity_id and i.status in ('imported','needs_review','ready') and i.flagged_at is null
       and il.requires_review is true and il.excluded_at is null and (p_after is null or il.id > p_after)
     order by il.id limit v_lim) b;
  return jsonb_build_object('ok', true, 'rows', v_rows,
    'next_after', case when v_n = v_lim then v_rows->(v_n - 1)->>'line_id' end);
end $$;

-- Leverandørkoblinger (vare, grunnenhet, kostpris, varenumre inkl. bekreftede lærte varenumre) og leverandørregler.
create or replace function public.rm_queue_reset_catalog(p_legal_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._rm_qr_guard(p_legal_entity_id);
  return jsonb_build_object('ok', true,
    'suppliers', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'new_item_type', s.new_item_type)), '[]'::jsonb)
                    from suppliers s where s.legal_entity_id = p_legal_entity_id),
    'links', (select coalesce(jsonb_agg(jsonb_build_object('supplier_id', rms.supplier_id, 'raw_material_id', rm.id, 'name', rm.name,
                'base_unit', rm.base_unit, 'is_active', coalesce(rm.is_active, true), 'cost', rm.current_cost_price,
                'skus', (select coalesce(jsonb_agg(distinct q.x), '[]'::jsonb) from (
                           select public.rm_sku_norm(rms.supplier_sku) as x
                           union select public.rm_sku_norm(a.alias_value) from raw_material_supplier_aliases a
                            where a.raw_material_supplier_id = rms.id and a.alias_type::text = 'supplier_sku' and a.status::text = 'confirmed') q
                          where coalesce(q.x, '') <> ''))), '[]'::jsonb)
                from raw_material_suppliers rms join raw_materials rm on rm.id = rms.raw_material_id
               where rm.legal_entity_id = p_legal_entity_id),
    'settings', public.rm_fra_faktura_settings(p_legal_entity_id));
end $$;

-- 5 Start, fase 2, bolker ---------------------------------------------------------------------------------------------
create or replace function public.rm_queue_reset_start(p_legal_entity_id uuid, p_fingerprint text, p_summary jsonb, p_snapshot uuid[], p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_run uuid; v_bad int; v_n int;
begin
  v_uid := public._rm_qr_guard(p_legal_entity_id);
  if coalesce(btrim(p_fingerprint), '') = '' or length(p_fingerprint) > 200 then raise exception 'ugyldig_fingeravtrykk' using errcode = '22023'; end if;
  if p_snapshot is null or cardinality(p_snapshot) = 0 or cardinality(p_snapshot) > 20000 then raise exception 'ugyldig_utvalg' using errcode = '22023'; end if;
  if (select count(distinct x) from unnest(p_snapshot) x) <> cardinality(p_snapshot) then raise exception 'dobbel_linje_i_utvalget' using errcode = '22023'; end if;
  if p_summary is not null and length(p_summary::text) > 200000 then raise exception 'for_stort_sammendrag' using errcode = '22023'; end if;
  perform 1 from rm_queue_reset_runs where legal_entity_id = p_legal_entity_id for update;
  if exists (select 1 from rm_queue_reset_runs where legal_entity_id = p_legal_entity_id and status in ('aktiv','pause')) then
    return jsonb_build_object('ok', false, 'error', 'kjoring_pagar');
  end if;
  select count(*) into v_bad from unnest(p_snapshot) x where not public._rm_qr_line_open(x, p_legal_entity_id);
  if v_bad > 0 then return jsonb_build_object('ok', false, 'error', 'koen_endret', 'changed', v_bad); end if;

  insert into rm_queue_reset_runs (legal_entity_id, fingerprint, plan_summary, snapshot_count, created_by)
  values (p_legal_entity_id, p_fingerprint, coalesce(p_summary, '{}'::jsonb), cardinality(p_snapshot), v_uid) returning id into v_run;
  insert into rm_queue_reset_snapshot (run_id, line_id, invoice_id)
  select v_run, il.id, il.invoice_id from invoice_lines il where il.id = any(p_snapshot);
  v_n := public._rm_qr_insert_items(v_run, p_legal_entity_id, 1::smallint, p_items);
  insert into audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'queue_reset.started', 'rm_queue_reset_run', v_run, p_legal_entity_id,
          jsonb_build_object('run_id', v_run, 'snapshot_lines', cardinality(p_snapshot), 'phase1_steps', v_n, 'fingerprint', p_fingerprint),
          'Nullstilling 18.11.2026', 'ravarer');
  return jsonb_build_object('ok', true, 'run_id', v_run, 'steps', v_n);
end $$;

-- Fase 2 (etter regel 1–4): regel 2 på nytt for linjer som fikk prisårsak, og regel 6 for alt som fortsatt er åpent i utvalget.
create or replace function public.rm_queue_reset_add_phase2(p_run_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_run rm_queue_reset_runs%rowtype; v_uid uuid; v_bad int; v_n int;
begin
  select * into v_run from rm_queue_reset_runs where id = p_run_id for update;
  if not found then raise exception 'kjoring_finnes_ikke' using errcode = '22023'; end if;
  v_uid := public._rm_qr_guard(v_run.legal_entity_id);
  if v_run.status <> 'aktiv' or v_run.phase <> 1 then return jsonb_build_object('ok', false, 'error', 'ikke_klar_for_fase2', 'status', v_run.status, 'phase', v_run.phase); end if;
  if exists (select 1 from rm_queue_reset_items where run_id = p_run_id and phase = 1 and status in ('venter','pagar','uavklart')) then
    return jsonb_build_object('ok', false, 'error', 'fase1_ikke_ferdig');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'ugyldige_steg' using errcode = '22023'; end if;
  select count(*) into v_bad from jsonb_array_elements(p_items) e, jsonb_array_elements_text(e->'line_ids') x
   where not public._rm_qr_line_open(x::uuid, v_run.legal_entity_id);
  if v_bad > 0 then return jsonb_build_object('ok', false, 'error', 'koen_endret', 'changed', v_bad); end if;
  v_n := public._rm_qr_insert_items(p_run_id, v_run.legal_entity_id, 2::smallint, p_items);
  update rm_queue_reset_runs set phase = 2, updated_at = now() where id = p_run_id;
  insert into audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'queue_reset.phase2', 'rm_queue_reset_run', p_run_id, v_run.legal_entity_id,
          jsonb_build_object('run_id', p_run_id, 'phase2_steps', v_n), 'Nullstilling 18.11.2026', 'ravarer');
  return jsonb_build_object('ok', true, 'steps', v_n);
end $$;

-- Neste bolk: venter → pågår med eget krav-token. Steg for en leverandørvare med uavklart utfall holdes tilbake.
create or replace function public.rm_queue_reset_claim(p_run_id uuid, p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_run rm_queue_reset_runs%rowtype; v_token uuid := gen_random_uuid(); v_items jsonb;
begin
  select * into v_run from rm_queue_reset_runs where id = p_run_id for update;
  if not found then raise exception 'kjoring_finnes_ikke' using errcode = '22023'; end if;
  perform public._rm_qr_guard(v_run.legal_entity_id);
  if v_run.status <> 'aktiv' then return jsonb_build_object('ok', true, 'status', v_run.status, 'phase', v_run.phase, 'items', '[]'::jsonb); end if;
  with picked as (
    select it.id from rm_queue_reset_items it
     where it.run_id = p_run_id and it.phase = v_run.phase and it.status = 'venter'
       and not exists (select 1 from rm_queue_reset_items u where u.run_id = p_run_id and u.status = 'uavklart'
                        and u.supplier_id is not distinct from it.supplier_id and u.item_key is not distinct from it.item_key and u.item_key is not null)
     order by it.seq limit greatest(1, least(coalesce(p_limit, 5), 20)) for update skip locked),
  upd as (
    update rm_queue_reset_items it set status = 'pagar', claim_token = v_token, claimed_at = now(), attempts = it.attempts + 1, updated_at = now()
      from picked where it.id = picked.id
    returning it.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'seq', seq, 'phase', phase, 'rule', rule, 'action', action, 'supplier_id', supplier_id,
           'item_key', item_key, 'raw_material_id', raw_material_id, 'line_ids', to_jsonb(line_ids), 'payload', payload, 'reason_code', reason_code,
           'op_id', op_id, 'claim_token', claim_token, 'attempts', attempts) order by seq), '[]'::jsonb) into v_items from upd;
  return jsonb_build_object('ok', true, 'status', v_run.status, 'phase', v_run.phase, 'items', v_items);
end $$;

create or replace function public.rm_queue_reset_finish(p_item_id uuid, p_claim_token uuid, p_status text, p_result jsonb, p_error text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_it rm_queue_reset_items%rowtype; v_uid uuid; v_created uuid;
begin
  select * into v_it from rm_queue_reset_items where id = p_item_id for update;
  if not found then raise exception 'steg_finnes_ikke' using errcode = '22023'; end if;
  v_uid := public._rm_qr_guard(v_it.legal_entity_id);
  if p_status not in ('ferdig','feilet','uavklart') then raise exception 'ugyldig_status' using errcode = '22023'; end if;
  if v_it.status <> 'pagar' or v_it.claim_token is distinct from p_claim_token then
    return jsonb_build_object('ok', false, 'error', 'ikke_din_tur', 'status', v_it.status);
  end if;
  if v_it.action = 'opprett' and p_status = 'ferdig' and coalesce(p_result->>'raw_material_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and coalesce(p_result->>'created', '') = 'true' then
    v_created := (p_result->>'raw_material_id')::uuid;
  end if;
  update rm_queue_reset_items set status = p_status,
         result = case when p_result is null or length(p_result::text) > 50000 then jsonb_build_object('avkortet', p_result is not null) else p_result end,
         error = left(nullif(btrim(coalesce(p_error, '')), ''), 1000), claim_token = null,
         finished_at = case when p_status = 'uavklart' then null else now() end,
         created_raw_material_id = coalesce(v_created, created_raw_material_id), updated_at = now()
   where id = p_item_id;
  insert into audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'queue_reset.step', 'rm_queue_reset_item', v_it.id, v_it.legal_entity_id,
          jsonb_build_object('run_id', v_it.run_id, 'phase', v_it.phase, 'rule', v_it.rule, 'action', v_it.action, 'status', p_status,
                             'supplier_id', v_it.supplier_id, 'item_key', v_it.item_key, 'lines', cardinality(v_it.line_ids),
                             'raw_material_id', coalesce(v_created, v_it.raw_material_id), 'error', left(p_error, 300)),
          'Nullstilling 18.11.2026 – regel ' || v_it.rule, 'ravarer');
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

-- Steg som har stått «pågår» lenger enn fristen (f.eks. etter omlasting) blir uavklart – aldri automatisk kjørt på nytt.
create or replace function public.rm_queue_reset_recover(p_run_id uuid, p_stale_seconds integer default 180)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_run rm_queue_reset_runs%rowtype; v_n int;
begin
  select * into v_run from rm_queue_reset_runs where id = p_run_id;
  if not found then raise exception 'kjoring_finnes_ikke' using errcode = '22023'; end if;
  perform public._rm_qr_guard(v_run.legal_entity_id);
  update rm_queue_reset_items set status = 'uavklart', claim_token = null, updated_at = now()
   where run_id = p_run_id and status = 'pagar' and claimed_at < now() - make_interval(secs => greatest(coalesce(p_stale_seconds, 180), 0));
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'uavklart', v_n);
end $$;

-- Kontroll av uavklart steg: fant handlingen sted? Bevis = revisjonslogg med stegets id i begrunnelsen (alle skriveveiene
-- lagrer begrunnelsen), eller for «hold utenfor» linjens op-id. Ja → ferdig (bekreftet ved kontroll). Nei → venter (trygt å
-- sende på nytt: linjeutvalget er fryst, og «hold utenfor» har samme op-id).
create or replace function public.rm_queue_reset_check(p_item_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_it rm_queue_reset_items%rowtype; v_run rm_queue_reset_runs%rowtype; v_a record; v_done boolean := false; v_created uuid;
begin
  select * into v_it from rm_queue_reset_items where id = p_item_id for update;
  if not found then raise exception 'steg_finnes_ikke' using errcode = '22023'; end if;
  perform public._rm_qr_guard(v_it.legal_entity_id);
  if v_it.status <> 'uavklart' then return jsonb_build_object('ok', true, 'status', v_it.status, 'changed', false); end if;
  select * into v_run from rm_queue_reset_runs where id = v_it.run_id;
  if v_it.action = 'hold_utenfor' then
    v_done := exists (select 1 from invoice_lines il where il.id = v_it.line_ids[1] and il.excluded_at is not null and il.exclusion_prev->>'op_id' = v_it.op_id::text);
  else
    select a.action, a.changes into v_a from audit_log a
     where a.legal_entity_id = v_it.legal_entity_id and a.occurred_at >= v_run.created_at and a.action <> 'queue_reset.step'
       and strpos(coalesce(a.reason, ''), v_it.id::text) > 0
     order by a.occurred_at desc limit 1;
    v_done := found;
    if v_done and v_it.action = 'opprett' and coalesce(v_a.changes->>'created_raw_material', '') = 'true'
       and coalesce(v_a.changes->>'raw_material_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_created := (v_a.changes->>'raw_material_id')::uuid;
    end if;
  end if;
  update rm_queue_reset_items set status = case when v_done then 'ferdig' else 'venter' end,
         result = coalesce(result, '{}'::jsonb) || jsonb_build_object('kontrollert', true, 'fant_handling', v_done),
         finished_at = case when v_done then now() end, created_raw_material_id = coalesce(v_created, created_raw_material_id), updated_at = now()
   where id = p_item_id;
  return jsonb_build_object('ok', true, 'status', case when v_done then 'ferdig' else 'venter' end, 'changed', true);
end $$;

create or replace function public.rm_queue_reset_set_status(p_run_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_run rm_queue_reset_runs%rowtype; v_uid uuid; v_new text; v_skipped int := 0;
begin
  select * into v_run from rm_queue_reset_runs where id = p_run_id for update;
  if not found then raise exception 'kjoring_finnes_ikke' using errcode = '22023'; end if;
  v_uid := public._rm_qr_guard(v_run.legal_entity_id);
  if p_action = 'pause' and v_run.status = 'aktiv' then v_new := 'pause';
  elsif p_action = 'fortsett' and v_run.status = 'pause' then v_new := 'aktiv';
  elsif p_action = 'stopp' and v_run.status in ('aktiv','pause') then v_new := 'stoppet';
  else return jsonb_build_object('ok', false, 'error', 'ugyldig_overgang', 'status', v_run.status);
  end if;
  if v_new = 'stoppet' then
    update rm_queue_reset_items set status = 'hoppet_over', updated_at = now() where run_id = p_run_id and status = 'venter';
    get diagnostics v_skipped = row_count;
  end if;
  update rm_queue_reset_runs set status = v_new, updated_at = now(),
         finished_at = case when v_new = 'stoppet' then now() else finished_at end,
         finished_by = case when v_new = 'stoppet' then v_uid else finished_by end
   where id = p_run_id;
  insert into audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'queue_reset.' || p_action, 'rm_queue_reset_run', p_run_id, v_run.legal_entity_id,
          jsonb_build_object('run_id', p_run_id, 'from', v_run.status, 'to', v_new, 'skipped', v_skipped), 'Nullstilling 18.11.2026', 'ravarer');
  return jsonb_build_object('ok', true, 'status', v_new, 'skipped', v_skipped);
end $$;

-- 6 Avslutning ---------------------------------------------------------------------------------------------------------
-- Ferdig når fase 2 ikke har steg igjen. Fakturaer i utvalget uten åpne linjer legges i omregningskøen (dagens regler for
-- status; motoren avstemmer eller godkjenner aldri). Grensen settes til 1 % bare når ingen steg feilet.
create or replace function public.rm_queue_reset_complete(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_run rm_queue_reset_runs%rowtype; v_uid uuid; v_failed int; v_inv uuid[]; v_chunk uuid[]; v_i int := 1;
  v_queued int := 0; v_r jsonb; v_before jsonb; v_set boolean := false;
begin
  select * into v_run from rm_queue_reset_runs where id = p_run_id for update;
  if not found then raise exception 'kjoring_finnes_ikke' using errcode = '22023'; end if;
  v_uid := public._rm_qr_guard(v_run.legal_entity_id);
  if v_run.status <> 'aktiv' or v_run.phase <> 2 then return jsonb_build_object('ok', false, 'error', 'ikke_klar', 'status', v_run.status, 'phase', v_run.phase); end if;
  if exists (select 1 from rm_queue_reset_items where run_id = p_run_id and status in ('venter','pagar','uavklart')) then
    return jsonb_build_object('ok', false, 'error', 'steg_gjenstar');
  end if;
  select count(*) into v_failed from rm_queue_reset_items where run_id = p_run_id and status = 'feilet';
  select coalesce(array_agg(distinct s.invoice_id), '{}') into v_inv
    from rm_queue_reset_snapshot s join invoices i on i.id = s.invoice_id
   where s.run_id = p_run_id and i.status in ('imported','needs_review','ready') and i.flagged_at is null
     and not exists (select 1 from invoice_lines l where l.invoice_id = i.id and l.requires_review is true and l.excluded_at is null);
  while v_i <= coalesce(cardinality(v_inv), 0) loop
    v_chunk := v_inv[v_i : v_i + 999];
    v_r := public.rm_rematch_invoices(v_run.legal_entity_id, 1000, v_chunk, true);
    v_queued := v_queued + coalesce((v_r->>'queued')::int, 0);
    v_i := v_i + 1000;
  end loop;
  v_before := public.rm_fra_faktura_settings(v_run.legal_entity_id);
  if v_failed = 0 then
    perform public.rm_set_fra_faktura_settings(v_run.legal_entity_id, 1, null, null);
    v_set := true;
  end if;
  update rm_queue_reset_runs set status = 'ferdig', finished_at = now(), finished_by = v_uid, settings_before = v_before,
         price_jump_set_at = case when v_set then now() end,
         rematch = jsonb_build_object('invoices', coalesce(cardinality(v_inv), 0), 'queued', v_queued), updated_at = now()
   where id = p_run_id;
  insert into audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'queue_reset.finished', 'rm_queue_reset_run', p_run_id, v_run.legal_entity_id,
          jsonb_build_object('run_id', p_run_id, 'failed', v_failed, 'rematch_invoices', coalesce(cardinality(v_inv), 0), 'queued', v_queued,
                             'price_jump_pct_set', v_set, 'before', v_before->'price_jump_pct'), 'Nullstilling 18.11.2026', 'ravarer');
  return jsonb_build_object('ok', true, 'failed', v_failed, 'rematch_invoices', coalesce(cardinality(v_inv), 0), 'queued', v_queued, 'price_jump_set', v_set);
end $$;

-- «Sett grensen til 1 % nå» i kvitteringen når noen steg feilet (Henrik velger selv).
create or replace function public.rm_queue_reset_set_limit(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_run rm_queue_reset_runs%rowtype; v_uid uuid; v_before jsonb;
begin
  select * into v_run from rm_queue_reset_runs where id = p_run_id for update;
  if not found then raise exception 'kjoring_finnes_ikke' using errcode = '22023'; end if;
  v_uid := public._rm_qr_guard(v_run.legal_entity_id);
  if v_run.status <> 'ferdig' then return jsonb_build_object('ok', false, 'error', 'ikke_ferdig'); end if;
  if v_run.price_jump_set_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  v_before := public.rm_fra_faktura_settings(v_run.legal_entity_id);
  perform public.rm_set_fra_faktura_settings(v_run.legal_entity_id, 1, null, null);
  update rm_queue_reset_runs set price_jump_set_at = now(), settings_before = coalesce(settings_before, v_before), updated_at = now() where id = p_run_id;
  return jsonb_build_object('ok', true, 'already', false);
end $$;

-- Angre: appen kaller de underliggende angre-funksjonene og registrerer utfallet her.
create or replace function public.rm_queue_reset_undo_mark(p_item_id uuid, p_status text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_it rm_queue_reset_items%rowtype; v_uid uuid;
begin
  select * into v_it from rm_queue_reset_items where id = p_item_id for update;
  if not found then raise exception 'steg_finnes_ikke' using errcode = '22023'; end if;
  v_uid := public._rm_qr_guard(v_it.legal_entity_id);
  if p_status not in ('angret','delvis','kan_ikke') then raise exception 'ugyldig_status' using errcode = '22023'; end if;
  if v_it.status <> 'ferdig' then return jsonb_build_object('ok', false, 'error', 'ikke_utfort'); end if;
  if v_it.undo_status = 'angret' then return jsonb_build_object('ok', true, 'already', true); end if;
  update rm_queue_reset_items set undo_status = p_status, undo_result = case when length(coalesce(p_result, '{}'::jsonb)::text) > 50000 then null else p_result end,
         undone_at = now(), undone_by = v_uid, updated_at = now() where id = p_item_id;
  insert into audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'queue_reset.undo', 'rm_queue_reset_item', v_it.id, v_it.legal_entity_id,
          jsonb_build_object('run_id', v_it.run_id, 'rule', v_it.rule, 'action', v_it.action, 'undo_status', p_status),
          'Angret nullstilling 18.11.2026 – regel ' || v_it.rule, 'ravarer');
  return jsonb_build_object('ok', true, 'already', false);
end $$;

-- 7 Status og kvittering (lesing) ---------------------------------------------------------------------------------------
create or replace function public.rm_queue_reset_status(p_legal_entity_id uuid, p_run_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_run rm_queue_reset_runs%rowtype; v_counts jsonb; v_failed jsonb; v_cost jsonb; v_created int; v_open int;
begin
  if auth.uid() is null or not coalesce(public.has_ravarer_invoice_access(p_legal_entity_id, 'read'), false) then
    raise exception 'Mangler tilgang til fakturaer' using errcode = '42501';
  end if;
  select * into v_run from rm_queue_reset_runs where legal_entity_id = p_legal_entity_id and (p_run_id is null or id = p_run_id)
   order by created_at desc limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'run', null, 'can_run', coalesce(public.has_ravarer_invoice_approve(p_legal_entity_id), false));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('phase', g.phase, 'rule', g.rule, 'action', g.action, 'status', g.status, 'reason_code', g.reason_code,
           'items', g.n, 'lines', g.l, 'undone', g.u)), '[]'::jsonb) into v_counts
    from (select phase, rule, action, status, reason_code, count(*) n, sum(cardinality(line_ids)) l, count(*) filter (where undo_status = 'angret') u
            from rm_queue_reset_items where run_id = v_run.id group by phase, rule, action, status, reason_code) g;
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'phase', f.phase, 'rule', f.rule, 'action', f.action, 'error', f.error,
           'supplier_name', f.supplier_name, 'item_key', f.item_key, 'title', f.payload->>'title', 'lines', cardinality(f.line_ids))), '[]'::jsonb) into v_failed
    from (select it.*, s.name as supplier_name from rm_queue_reset_items it left join suppliers s on s.id = it.supplier_id
           where it.run_id = v_run.id and it.status = 'feilet' order by it.phase, it.seq limit 300) f;
  select coalesce(jsonb_agg(c), '[]'::jsonb) into v_cost from (
    select jsonb_build_object('raw_material_id', rm.id, 'name', rm.name, 'base_unit', rm.base_unit, 'before', b.before,
                              'now', rm.current_cost_price, 'created', b.created) c
      from (select coalesce(it.created_raw_material_id, it.raw_material_id) rid, bool_or(it.created_raw_material_id is not null) created,
                   (array_agg(nullif(it.payload->>'cost_before', '')::numeric order by it.phase, it.seq))[1] before
              from rm_queue_reset_items it
             where it.run_id = v_run.id and it.status = 'ferdig' and it.action in ('godta_pris','bekreft_pakning','koble','opprett')
               and coalesce(it.created_raw_material_id, it.raw_material_id) is not null
             group by 1) b
      join raw_materials rm on rm.id = b.rid
     where rm.current_cost_price is distinct from b.before
     order by rm.name limit 2000) q;
  select count(distinct created_raw_material_id) into v_created from rm_queue_reset_items where run_id = v_run.id and created_raw_material_id is not null;
  select count(*) into v_open from rm_queue_reset_snapshot s where s.run_id = v_run.id and public._rm_qr_line_open(s.line_id, p_legal_entity_id);
  return jsonb_build_object('ok', true, 'can_run', coalesce(public.has_ravarer_invoice_approve(p_legal_entity_id), false),
    'run', jsonb_build_object('id', v_run.id, 'label', v_run.label, 'status', v_run.status, 'phase', v_run.phase, 'snapshot_count', v_run.snapshot_count,
      'created_at', v_run.created_at, 'created_by', v_run.created_by, 'finished_at', v_run.finished_at, 'price_jump_set_at', v_run.price_jump_set_at,
      'settings_before', v_run.settings_before, 'rematch', v_run.rematch, 'plan_summary', v_run.plan_summary),
    'counts', v_counts, 'failed', v_failed, 'cost_changes', v_cost, 'created_items', v_created, 'still_open', v_open,
    'pending_claims', (select count(*) from rm_queue_reset_items where run_id = v_run.id and status = 'pagar'),
    'oldest_claim', (select min(claimed_at) from rm_queue_reset_items where run_id = v_run.id and status = 'pagar'));
end $$;

create or replace function public.rm_cap_nullstill_koen_v1()
returns boolean language sql stable security definer set search_path = public as $$ select true $$;

revoke all on function public.rm_queue_reset_snapshot_lines(uuid, uuid, integer), public.rm_queue_reset_catalog(uuid),
  public.rm_queue_reset_start(uuid, text, jsonb, uuid[], jsonb), public.rm_queue_reset_add_phase2(uuid, jsonb), public.rm_queue_reset_claim(uuid, integer),
  public.rm_queue_reset_finish(uuid, uuid, text, jsonb, text), public.rm_queue_reset_recover(uuid, integer), public.rm_queue_reset_check(uuid),
  public.rm_queue_reset_set_status(uuid, text), public.rm_queue_reset_complete(uuid), public.rm_queue_reset_set_limit(uuid),
  public.rm_queue_reset_undo_mark(uuid, text, jsonb), public.rm_queue_reset_status(uuid, uuid), public.rm_cap_nullstill_koen_v1() from public, anon;
grant execute on function public.rm_queue_reset_snapshot_lines(uuid, uuid, integer), public.rm_queue_reset_catalog(uuid),
  public.rm_queue_reset_start(uuid, text, jsonb, uuid[], jsonb), public.rm_queue_reset_add_phase2(uuid, jsonb), public.rm_queue_reset_claim(uuid, integer),
  public.rm_queue_reset_finish(uuid, uuid, text, jsonb, text), public.rm_queue_reset_recover(uuid, integer), public.rm_queue_reset_check(uuid),
  public.rm_queue_reset_set_status(uuid, text), public.rm_queue_reset_complete(uuid), public.rm_queue_reset_set_limit(uuid),
  public.rm_queue_reset_undo_mark(uuid, text, jsonb), public.rm_queue_reset_status(uuid, uuid), public.rm_cap_nullstill_koen_v1() to authenticated, service_role;

-- Sluttsteg: funksjonene filen oppretter eller endrer skrives på nytt uten CR (innliming med Windows-linjeskift).
do $lf$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' and strpos(p.prosrc, chr(13)) > 0
              and (p.proname like 'rm\_queue\_reset\_%' or p.proname like '\_rm\_qr\_%'
                   or p.proname = any (array['rm_cap_nullstill_koen_v1', 'rm_set_invoice_exclusion'])) loop
    execute replace(pg_get_functiondef(r.oid), chr(13), '');
  end loop;
end $lf$;

commit;
