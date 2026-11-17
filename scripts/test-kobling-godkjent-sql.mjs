// 20261121_kobling_godkjent_faktura: kjører PENDING-filen i innebygd PostgreSQL (PGlite) mot byte-identiske kopier av dagens
// live-funksjoner (md5 kontrollert av filen selv) og prøver reglene med ekte kall. Rører aldri live.
// Bruk: node scripts/test-kobling-godkjent-sql.mjs
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const pending = read("supabase/pending/20261121_kobling_godkjent_faktura.PENDING.sql");
const checkSql = read("supabase/pending/20261121_kobling_godkjent_faktura.check.sql");
const fx = (n, dir = "live-20261117b") => read(`scripts/fixtures/${dir}/${n}.sql`);

const stub = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function public.has_ravarer_invoice_access(uuid, text) returns boolean language sql stable as $$ select true $$;
create function public.has_ravarer_invoice_approve(uuid) returns boolean language sql stable as $$ select true $$;
create function public.rm_sku_norm(p text) returns text language sql immutable as $$ select lower(regexp_replace(coalesce(p,''), '[^a-zA-Z0-9]', '', 'g')) $$;
create function public.rm_match_key(p text) returns text language sql immutable as $$ select lower(regexp_replace(btrim(coalesce(p,'')), '\\s+', ' ', 'g')) $$;
create function public.rm_is_finite(numeric) returns boolean language sql immutable as $$ select $1 is not null $$;
create function public.rm_expected_base_quantity(numeric, text, text, numeric) returns jsonb language sql immutable as
  $$ select case when $2 = $3 then jsonb_build_object('status','ok','expected',$1) else jsonb_build_object('status','mangler') end $$;
create function public.rm_confirm_start_price(uuid, numeric) returns jsonb language sql as $$ select '{"created":false}'::jsonb $$;
create function public.rm_invoice_has_read_issues(uuid) returns boolean language sql stable as $$ select false $$;
create function public._rm_queue_line_read_issue(uuid, boolean) returns text language sql stable as $$ select null::text $$;
create function public._rm_queue_line_effect(uuid, boolean) returns numeric language sql stable as $$ select null::numeric $$;
create table audit_log (id serial, user_id uuid, action text, entity_type text, entity_id uuid, entity_display_reference text, legal_entity_id uuid,
  changes jsonb, reason text, source_app text, occurred_at timestamptz default now());
create table suppliers (id uuid primary key, legal_entity_id uuid, name text);
create table raw_materials (id uuid primary key default gen_random_uuid(), legal_entity_id uuid, sku text, name text, category text, base_unit text,
  item_type text, declaration_name text, package_size numeric, package_unit text, base_units_per_package numeric, package_confirmed_at timestamptz,
  package_confirmed_by uuid, primary_supplier_id uuid, is_active boolean default true, created_by uuid, price_source text);
create table raw_material_suppliers (id uuid primary key default gen_random_uuid(), raw_material_id uuid, supplier_id uuid, supplier_sku text,
  supplier_product_name text, package_size numeric, package_unit text, base_units_per_package numeric, package_confirmed_at timestamptz,
  package_confirmed_by uuid, agreed_price_per_base_unit numeric, agreement_valid_from date, agreement_valid_to date,
  start_price_per_base_unit numeric, container_unit text, is_primary boolean default false, updated_at timestamptz);
create table raw_material_supplier_aliases (id serial, raw_material_supplier_id uuid, alias_type text, alias_value text, status text,
  confirmed_by uuid, confirmed_at timestamptz, match_count int, last_seen_at timestamptz, rejected_at timestamptz, rejected_by uuid, rejected_reason text,
  alias_value_normalized text generated always as (lower(btrim(alias_value))) stored, unique (alias_type, alias_value_normalized, raw_material_supplier_id));
create table invoice_match_settings (legal_entity_id uuid primary key, use_first_confirmed_price_as_start boolean);
create table invoices (id uuid primary key, legal_entity_id uuid, supplier_id uuid, status text, flagged_at timestamptz, reconciled_at timestamptz,
  excluded_at timestamptz, excluded_by uuid, exclusion_category text, exclusion_reason text, exclusion_prev jsonb, flag_reason text,
  invoice_number text, invoice_date date, total_amount numeric, total_vat numeric, currency text default 'NOK', is_credit_note boolean default false,
  lines_sum_status text default 'ok', lines_sum_excl_vat numeric, updated_at timestamptz default now());
create table invoice_lines (id uuid primary key, invoice_id uuid, line_number int, created_at timestamptz default now(), supplier_sku text,
  description text, quantity numeric, unit text, unit_price numeric, total_amount numeric, raw_material_id uuid, match_confidence text,
  requires_review boolean, review_reason text, base_quantity numeric, price_per_base_unit numeric, expected_price_per_base_unit numeric,
  price_variance_pct numeric, variance_status text, resolution_note text, resolved_by uuid, resolved_at timestamptz,
  excluded_at timestamptz, excluded_by uuid, exclusion_category text, exclusion_reason text, exclusion_prev jsonb, excluded_raw_material_id uuid,
  updated_at timestamptz default now());
create table invoice_internal_approvals (id uuid primary key default gen_random_uuid(), invoice_id uuid, status text, revoked_at timestamptz, basis jsonb);
create table invoice_line_cost_postings (invoice_line_id uuid, revoked_at timestamptz);
create table invoice_line_exclusion_patterns (id serial, legal_entity_id uuid, supplier_id uuid, pattern_type text, pattern_value text, reason text,
  created_by uuid, created_at timestamptz default now());
create function public._rm_line_exclusion_blocker(p uuid) returns text language sql stable as
  $$ select case when exists (select 1 from invoice_line_cost_postings c where c.invoice_line_id = p and c.revoked_at is null) then 'kostpris_fort' end $$;
`;

let ok = 0;
const fail = (m) => { console.error("FEIL:", m); process.exit(1); };
const check = (cond, m) => { if (!cond) fail(m); ok++; };
const db = new PGlite();
const step = async (name, fn) => { try { return await fn(); } catch (e) { fail(`${name}: ${e.message}`); } };
const one = async (sql) => (await db.query(sql)).rows[0];
const val = async (sql) => Object.values(await one(sql))[0];

const LE = "00000000-0000-0000-0000-0000000000a1";
const SUP = "00000000-0000-0000-0000-0000000000b1";
const RM = "00000000-0000-0000-0000-0000000000c1";
const UID = "00000000-0000-0000-0000-0000000000e1";
const inv = (n) => `00000000-0000-0000-0001-${String(n).padStart(12, "0")}`;
const ln = (n) => `00000000-0000-0000-0002-${String(n).padStart(12, "0")}`;
const INV = { appr: inv(1), recon: inv(2), flag: inv(3), open: inv(4), appr2: inv(5) };

await step("stubb", () => db.exec(stub));
for (const n of ["rm_confirm_line_match", "rm_link_supplier_item", "rm_undo_not_item", "rm_set_invoice_exclusion"]) await step(n, () => db.exec(fx(n)));
await step("rm_work_items", () => db.exec(fx("rm_work_items", "live-20261117")));
// Eldre utgaver (git HEAD) av de to 20261119-funksjonene, som om de var kjørt før denne filen.
const head = (p) => execSync(`git show HEAD:${p}`, { cwd: root, encoding: "utf8" });
const oldQueue = head("supabase/pending/20261119_nye_varer_les.PENDING.sql");
await step("gammel rm_new_items_queue", () => db.exec(oldQueue.slice(oldQueue.indexOf("create or replace function public.rm_new_items_queue"), oldQueue.indexOf("revoke all on function public.rm_new_items_queue"))));
const fra = head("supabase/pending/20261119_fra_faktura.PENDING.sql");
const us = fra.indexOf("create or replace function public.rm_undo_supplier_item_link");
await step("gammel rm_undo_supplier_item_link", () => db.exec(fra.slice(us, fra.indexOf("end $$;", us) + 7)));

const basis = (total, vat, status) => `'{"total_amount":${total},"total_vat":${vat},"currency":"NOK","lines_sum_status":"ok","lines_sum_excl_vat":${total - vat},"status":"${status}"}'`;
await step("data", () => db.exec(`
select set_config('test.uid', '${UID}', false);
insert into suppliers values ('${SUP}', '${LE}', 'ASKO');
insert into raw_materials (id, legal_entity_id, sku, name, base_unit) values ('${RM}', '${LE}', 'mel', 'Hvetemel', 'kg');
insert into invoices (id, legal_entity_id, supplier_id, status, reconciled_at, flagged_at, invoice_number, invoice_date, total_amount, total_vat, lines_sum_excl_vat) values
 ('${INV.appr}',  '${LE}', '${SUP}', 'needs_review', null, null, 'A-1', '2026-11-01', 1000, 200, 800),
 ('${INV.recon}', '${LE}', '${SUP}', 'reconciled', now(), null, 'R-1', '2026-11-02', 500, 100, 400),
 ('${INV.flag}',  '${LE}', '${SUP}', 'needs_review', null, now(), 'F-1', '2026-11-03', 300, 60, 240),
 ('${INV.open}',  '${LE}', '${SUP}', 'needs_review', null, null, 'O-1', '2026-11-04', 200, 40, 160),
 ('${INV.appr2}', '${LE}', '${SUP}', 'ready', null, null, 'A-2', '2026-11-05', 100, 20, 80);
insert into invoice_internal_approvals (invoice_id, status, basis) values
 ('${INV.appr}', 'approved', ${basis(1000, 200, "needs_review")}), ('${INV.appr2}', 'approved', ${basis(100, 20, "ready")});
insert into invoice_lines (id, invoice_id, line_number, supplier_sku, description, quantity, unit, unit_price, total_amount, match_confidence, requires_review, review_reason, resolution_note) values
 ('${ln(1)}',  '${INV.appr}',  1, '111', 'HVETEMEL 25KG', 25, 'kg', 20, 500, 'unmatched', true, 'unmatched', null),
 ('${ln(2)}',  '${INV.appr}',  2, '111', 'HVETEMEL 25KG', 10, 'kg', 20, 200, 'unmatched', true, 'unmatched', null),
 ('${ln(3)}',  '${INV.recon}', 1, '111', 'HVETEMEL 25KG', 25, 'kg', 20, 500, 'unmatched', true, 'unmatched', null),
 ('${ln(4)}',  '${INV.flag}',  1, '111', 'HVETEMEL 25KG', 15, 'kg', 20, 300, 'unmatched', true, 'unmatched', null),
 ('${ln(5)}',  '${INV.open}',  1, '111', 'HVETEMEL 25KG', 10, 'kg', 20, 200, 'unmatched', true, 'unmatched', null),
 ('${ln(6)}',  '${INV.appr}',  3, '222', 'PALLEGEBYR',     1, 'stk', 50, 50, 'unmatched', true, 'unmatched', null),
 ('${ln(7)}',  '${INV.appr}',  4, '333', 'MILJØGEBYR',     1, 'stk', 10, 10, 'not_applicable', false, null, 'Ikke vare: test'),
 ('${ln(8)}',  '${INV.appr}',  5, '333', 'MILJØGEBYR',     1, 'stk', 10, 10, 'not_applicable', false, null, 'Ikke vare: test'),
 ('${ln(9)}',  '${INV.recon}', 2, '444', 'KANEL',          1, 'kg', 120, 120, 'unmatched', true, 'unmatched', null),
 ('${ln(10)}', '${INV.appr2}', 1, '555', 'KARDEMOMME',     1, 'kg', 80, 80, 'unmatched', true, 'unmatched', null),
 ('${ln(11)}', '${INV.appr}',  6, '666', 'BAKEPAPIR',      1, 'stk', 40, 40, 'unmatched', true, 'unmatched', null);
insert into invoice_line_cost_postings values ('${ln(2)}', null), ('${ln(8)}', null);
`));

const link = (key, ids, extra = "") => val(`select public.rm_link_supplier_item('${LE}', '${SUP}', '${key}', p_line_ids => array[${ids.map((i) => `'${i}'`).join(",")}]::uuid[]${extra}) r`);
const kobling = async () => (await val(`select public.rm_work_items('${LE}', 'kobling', null, null, 'oldest', 500, 0) r`)).items;
const snapshot = async () => JSON.stringify((await db.query(`select (select jsonb_agg(to_jsonb(a) order by a.invoice_id) from invoice_internal_approvals a) a,
  (select jsonb_agg(to_jsonb(i) order by i.id) from invoices i) i,
  (select jsonb_agg(jsonb_build_array(l.id, l.quantity, l.unit, l.unit_price, l.total_amount, l.description, l.supplier_sku) order by l.id) from invoice_lines l) l`)).rows[0]);

// --- Før: dagens funksjoner (feilen Henrik fant) ---
check((await link("sku:555", [ln(10)], `, p_raw_material_id => '${RM}'`)).lines_updated === 0, "før: godkjent faktura gir 0 linjer");
const before444 = (await kobling()).find((c) => c.item_key === "sku:444");
check(before444 && Number(before444.open_lines) === 0, "før: vare uten åpne linjer (bare på avstemt faktura) står i Nye varer med 0 linjer");

// --- Kjør filen ---
await step("PENDING", () => db.exec(pending));
check((await val(`select public.rm_cap_kobling_godkjent_v1()`)) === true, "markør finnes");
let rerun = null;
try { await db.exec(pending); } catch (e) { rerun = e.message; await db.exec("rollback"); }
check(rerun && /allerede kjørt/.test(rerun), "filen stopper ved ny kjøring");
const undoDef = await val(`select pg_get_functiondef('public.rm_undo_supplier_item_link(uuid,uuid,text,uuid[],uuid,boolean,text)'::regprocedure)`);
check(!undoDef.includes("faktura_godkjent"), "rm_undo_supplier_item_link (eldre utgave) har mistet godkjenningssperren");
const queueDef = await val(`select pg_get_functiondef('public.rm_new_items_queue(uuid,uuid,integer,integer)'::regprocedure)`);
check(queueDef.includes("and a.open_lines > 0\n       and (a.linked_rm_id is null"), "rm_new_items_queue (eldre utgave) har fått samme regel");

// --- Kobling på internt godkjent faktura virker; avstemt, flagget og kostført er fortsatt sperret ---
const snap0 = await snapshot();
const r1 = await link("sku:111", [ln(1), ln(2), ln(3), ln(4), ln(5)], `, p_raw_material_id => '${RM}'`);
check(r1.ok === true && r1.lines_updated === 2, `kobling: 2 linjer (godkjent + åpen), fikk ${r1.lines_updated}`);
check(JSON.stringify([...r1.line_ids].sort()) === JSON.stringify([ln(1), ln(5)].sort()), "kobling: riktige linjer");
const l1 = await one(`select raw_material_id, match_confidence, requires_review, review_reason from invoice_lines where id = '${ln(1)}'`);
check(l1.raw_material_id === RM && l1.match_confidence === "manual" && l1.review_reason === "recalculation_pending", "linjen på godkjent faktura er koblet og venter på omregning");
for (const [id, why] of [[ln(2), "kostført"], [ln(3), "avstemt"], [ln(4), "flagget"]]) {
  const l = await one(`select raw_material_id, match_confidence from invoice_lines where id = '${id}'`);
  check(l.raw_material_id === null && l.match_confidence === "unmatched", `${why} linje er urørt`);
}
check(snap0 === await snapshot(), "godkjenning, fakturaer og beløp/antall/enhet/tekst er urørt av koblingen");
check(await val(`select current_setting('rm.link_approved', true)`) !== "on", "innstillingen lekker ikke ut av kallet");

// Direkte kall er fortsatt sperret, også rett etter en kobling i samme transaksjon.
const direct = await step("direkte i samme transaksjon", () => db.exec(`do $$ declare r jsonb; begin
  perform public.rm_link_supplier_item('${LE}', '${SUP}', 'sku:666', p_raw_material_id => '${RM}', p_line_ids => array['${ln(11)}']::uuid[]);
  r := public.rm_confirm_line_match('${ln(6)}', '${RM}');
  if r->>'reason' is distinct from 'faktura_godkjent' then raise exception 'direkte kall ble ikke sperret: %', r; end if;
end $$; select raw_material_id from invoice_lines where id = '${ln(11)}'`));
check(direct[1].rows[0].raw_material_id === RM, "kobling i samme transaksjon virket, og direkte kall etterpå ble sperret (faktura_godkjent)");

// Opprett som ny vare med pakning på godkjent faktura.
const r2 = await link("sku:555", [ln(10)], `, p_new_raw_material => '{"name":"Kardemomme","base_unit":"kg"}'::jsonb, p_package => '{"package_size":1,"package_unit":"kg","base_units_per_package":1,"confirm":true}'::jsonb`);
check(r2.lines_updated === 1 && r2.created_raw_material === true, "opprett som ny + pakning virker på godkjent faktura");
check((await val(`select count(*)::int from raw_material_suppliers where id = '${r2.raw_material_supplier_id}' and package_confirmed_at is not null`)) === 1, "pakningen er bekreftet");

// «Ikke vare» og angre på godkjent faktura.
const r3 = await link("sku:222", [ln(6)], ", p_not_raw_material => true, p_reason => 'test'");
check(r3.lines_updated === 1, "«Ikke vare» virker på godkjent faktura");
const u1 = await val(`select public.rm_undo_not_item('${LE}', '${SUP}', 'sku:333', array['${ln(7)}','${ln(8)}']::uuid[]) r`);
check(u1.undone.length === 1 && u1.undone[0].id === ln(7), "angre «Ikke vare» virker på godkjent faktura");
check(u1.skipped.length === 1 && u1.skipped[0].reason === "kostpris_fort", "angre «Ikke vare» på kostført linje er fortsatt sperret");

// Hold utenfor: én linje på godkjent faktura er lov; hele fakturaen og avstemt faktura er sperret.
const op = () => "gen_random_uuid()";
const upd = async (id) => val(`select updated_at::text from invoice_lines where id = '${id}'`);
const ex2 = await val(`select public.rm_set_invoice_exclusion('${INV.appr}', 'line', '${ln(11)}', 'annet', 'Test av hold utenfor', '${await upd(ln(11))}', ${op()}) r`);
check(ex2.ok === true, `hold utenfor én linje på godkjent faktura virker (${JSON.stringify(ex2)})`);
const invUpd = await val(`select updated_at::text from invoices where id = '${INV.appr}'`);
const ex3 = await val(`select public.rm_set_invoice_exclusion('${INV.appr}', 'invoice', null, 'annet', 'Test av hold utenfor', '${invUpd}', ${op()}) r`);
check(ex3.ok === false && ex3.error === "faktura_godkjent", "hold hele den godkjente fakturaen utenfor er fortsatt sperret");
const ex4 = await val(`select public.rm_set_invoice_exclusion('${INV.recon}', 'line', '${ln(9)}', 'annet', 'Test av hold utenfor', '${await upd(ln(9))}', ${op()}) r`);
check(ex4.ok === false && ex4.error === "faktura_avstemt", "hold utenfor på avstemt faktura er fortsatt sperret");
check((await val(`select count(*)::int from invoice_internal_approvals where status = 'approved' and revoked_at is null`)) === 2, "godkjenningene står");

// Kø = kobling: hver rad i Nye varer har minst én linje koblingen godtar, og tallet er likt.
const cards = await kobling();
check(!cards.some((c) => c.item_key === "sku:444"), "vare med bare avstemte linjer står ikke lenger i Nye varer");
for (const c of cards) {
  const n = await val(`select count(*)::int from invoice_lines il join invoices i on i.id = il.invoice_id
    where i.legal_entity_id = '${LE}' and i.supplier_id = '${c.supplier_id}' and il.requires_review and il.excluded_at is null
      and i.status in ('imported','needs_review','ready') and i.flagged_at is null and coalesce(il.match_confidence,'') <> 'not_applicable'
      and (case when public.rm_sku_norm(il.supplier_sku) <> '' then 'sku:' || public.rm_sku_norm(il.supplier_sku) else 'name:' || public.rm_match_key(il.description) end) = '${c.item_key}'
      and not exists (select 1 from invoice_line_cost_postings p where p.invoice_line_id = il.id and p.revoked_at is null)`);
  check(n > 0 && n === Number(c.open_lines), `${c.item_key}: køen viser ${c.open_lines}, koblingen godtar ${n}`);
}

// Kontrollfilen kjører (bare SELECT) og alle «etter»-kontroller er ok.
await db.exec(`select set_config('test.uid', '', false);`);
const results = await step("check.sql", () => db.exec(checkSql.replaceAll("751709bc-04b3-4449-867d-b97faa9ab373", LE)));
const rows = results[0].rows;
const bad = rows.filter((r) => r.etter_ok === false);
check(rows.length >= 8 && bad.length === 0, `check.sql etter kjøring: ${JSON.stringify(bad)}`);

console.log(`OK: ${ok} kontroller bestått`);
// Fingeravtrykk etter kjøring: 20261119_nye_varer_les.check.sql godtar dagens eller dette.
const wiAfter = await val(`select md5(pg_get_functiondef('public.rm_work_items(uuid,text,text,uuid,text,integer,integer)'::regprocedure))`);
check(wiAfter === "27451573d8696e4d95c3253798923a45", `rm_work_items md5 etter kjøring: ${wiAfter}`);
console.log(`OK: ${ok} kontroller bestått (med md5 etter kjøring)`);
