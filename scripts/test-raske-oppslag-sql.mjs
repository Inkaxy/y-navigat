// Raske oppslag (20261124 del 1 + del 2) i PGlite: tilgang kontrolleres én gang, samme rader som dagens direkte lesing,
// og radsikkerheten gir nøyaktig samme synlige rader før og etter del 2. Bruk: node scripts/test-raske-oppslag-sql.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { readSql, printFingerprint } from "./lib/pastedSql.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readSql(join(root, "supabase/pending", f));
const LE = "11111111-1111-1111-1111-111111111111", LE2 = "22222222-2222-2222-2222-222222222222";
const U_OK = "aaaaaaaa-0000-0000-0000-000000000001", U_NO = "aaaaaaaa-0000-0000-0000-000000000002", U_OWNER = "aaaaaaaa-0000-0000-0000-000000000003";

const stub = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create type access_level as enum ('none','read','write','admin');
create table legal_entities (id uuid primary key);
create table grants (user_id uuid, legal_entity_id uuid, invoice boolean, owner boolean);
create sequence access_calls; grant usage, select, update on sequence access_calls to authenticated;
create function public.has_ravarer_invoice_access(_le uuid, _lvl text default 'read') returns boolean language sql stable security definer set search_path = public as
  $$ select nextval('access_calls') > 0 and exists (select 1 from grants g where g.user_id = auth.uid() and g.legal_entity_id = _le and g.invoice) $$;
create function public.is_ravarer_owner(_u uuid, _le uuid) returns boolean language sql stable security definer set search_path = public as
  $$ select _u is not null and _le is not null and exists (select 1 from grants g where g.user_id = _u and g.legal_entity_id = _le and g.owner) $$;
create function public.has_ravarer_invoice_read_or_owner(_le uuid) returns boolean language sql stable security definer set search_path = public as
  $$ select public.has_ravarer_invoice_access(_le, 'read') or public.is_ravarer_owner(auth.uid(), _le) $$;
create function public.has_ravarer_access(_u uuid, _le uuid, _min access_level) returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from grants g where g.user_id = _u and g.legal_entity_id = _le) $$;
create table invoices (id uuid primary key default gen_random_uuid(), legal_entity_id uuid not null, invoice_number text, invoice_date date, supplier_id uuid,
  status text, flagged_at timestamptz, excluded_at timestamptz, total_amount numeric, total_vat numeric, is_credit_note boolean, lines_sum_excl_vat numeric,
  updated_at timestamptz default now(), line_extraction_status text, line_extraction_error text, lines_sum_status text, tripletex_supplier_invoice_id bigint);
create table raw_materials (id uuid primary key default gen_random_uuid(), legal_entity_id uuid, name text, base_unit text, item_type text, is_active boolean default true,
  stock_tracking boolean default false, current_stock numeric, min_stock numeric);
create table invoice_lines (id uuid primary key default gen_random_uuid(), invoice_id uuid references invoices, raw_material_id uuid, supplier_sku text, description text,
  price_per_base_unit numeric, expected_price_per_base_unit numeric, price_variance_pct numeric, review_reason text, requires_review boolean, excluded_at timestamptz);
create table raw_material_changelog (legal_entity_id uuid, acknowledged boolean, severity text);
create table raw_material_suppliers (raw_material_id uuid, agreed_price_per_base_unit numeric, agreement_valid_to date);
create view raw_material_stock_status as select id raw_material_id, legal_entity_id, current_stock, min_stock from raw_materials where stock_tracking and is_active;
grant usage on schema public, auth to authenticated, anon;
grant select on all tables in schema public to authenticated, anon;
alter table invoices enable row level security; alter table invoice_lines enable row level security;
create policy invoices_select on invoices for select using (has_ravarer_invoice_read_or_owner(legal_entity_id));
create policy invoice_lines_select on invoice_lines for select using (EXISTS ( SELECT 1
   FROM invoices i
  WHERE ((i.id = invoice_lines.invoice_id) AND has_ravarer_invoice_read_or_owner(i.legal_entity_id))));
insert into legal_entities values ('${LE}'), ('${LE2}');
insert into grants values ('${U_OK}', '${LE}', true, false), ('${U_OWNER}', '${LE}', false, true), ('${U_NO}', '${LE}', false, false);
`;

const db = new PGlite();
let n = 0;
const ok = (c, m) => { if (!c) throw new Error("FEIL: " + m); n++; };
const as = async (uid, sql) => {
  await db.exec(`set role authenticated; select set_config('test.uid', '${uid}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec("reset role; select set_config('test.uid', '', false);"); }
};
const fails = async (uid, sql, re) => { try { await as(uid, sql); return false; } catch (e) { return re.test(String(e.message)); } };

await db.exec(stub);
// Data: åpne/lukkede/flaggede fakturaer i to selskaper; linjer med og uten prisavvik.
const r = await db.query(`insert into raw_materials (legal_entity_id, name, stock_tracking, current_stock, min_stock) values ('${LE}', 'Mel', true, 1, 5), ('${LE}', 'Salt', false, 1, 5) returning id`);
const rm = r.rows[0].id;
const inv = async (le, status, extra = "") => (await db.query(`insert into invoices (legal_entity_id, invoice_number, invoice_date, status${extra ? ", " + extra.split("=")[0] : ""}) values ('${le}', 'F', '2026-11-01', '${status}'${extra ? ", " + extra.split("=")[1] : ""}) returning id`)).rows[0].id;
const iOpen = await inv(LE, "needs_review"), iDone = await inv(LE, "reconciled"), iFlag = await inv(LE, "ready", "flagged_at=now()"), iOther = await inv(LE2, "needs_review");
const iMis = await inv(LE, "imported", "lines_sum_status='mismatch'"), iFail = await inv(LE, "needs_review", "line_extraction_status='failed'"), iFailDone = await inv(LE, "reconciled", "line_extraction_status='failed'");
for (const [i, pv, rr, ex] of [[iOpen, 30, true, null], [iOpen, null, true, null], [iOpen, 25, true, "now()"], [iOpen, 10, false, null], [iDone, 40, true, null], [iFlag, 40, true, null], [iOther, 40, true, null], [iMis, 5, true, null]])
  await db.query(`insert into invoice_lines (invoice_id, raw_material_id, price_variance_pct, requires_review, excluded_at) values ('${i}', '${rm}', ${pv ?? "null"}, ${rr}, ${ex ?? "null"})`);
await db.exec(`insert into raw_material_changelog values ('${LE}', false, 'high'), ('${LE}', true, 'high'), ('${LE}', false, 'low');
  insert into raw_material_suppliers values ('${rm}', 10, current_date + 10), ('${rm}', 10, current_date + 60), ('${rm}', null, current_date + 5);`);

// Dagens direkte lesing (som appen sender) – fasit for de nye funksjonene.
const directJump = `select il.id from invoice_lines il join invoices i on i.id = il.invoice_id where il.requires_review and il.excluded_at is null and il.price_variance_pct is not null and il.raw_material_id is not null and i.legal_entity_id = '${LE}' and i.status in ('imported','needs_review','ready') and i.flagged_at is null order by il.id`;
const directUnread = `select i.id from invoices i where i.legal_entity_id = '${LE}' and i.status in ('imported','needs_review','ready') and i.excluded_at is null and i.flagged_at is null and (i.line_extraction_status = 'failed' or i.line_extraction_error is not null or i.lines_sum_status = 'mismatch') order by i.id`;
const visible = async (uid) => ({ inv: (await as(uid, "select id from invoices order by id")).map((x) => x.id).join(), lines: (await as(uid, "select id from invoice_lines order by id")).map((x) => x.id).join() });
const calls = async (sql) => { await db.exec("select setval('access_calls', 1, false)"); await as(U_OK, sql); return Number((await db.query("select last_value - 1 n from access_calls")).rows[0].n); };
const callsBefore = await calls("select count(*) from invoice_lines");
const before = { ok: await visible(U_OK), owner: await visible(U_OWNER), no: await visible(U_NO) };
const fasitJump = (await as(U_OK, directJump)).map((x) => x.id);
const fasitUnread = (await as(U_OK, directUnread)).map((x) => x.id);
ok(fasitJump.length === 2 && fasitUnread.length === 2, "testdata gir 2 prishopp-linjer og 2 uleste");

// DEL 1
await db.exec(read("kjort/02_raske_oppslag_del1.sql"));
const j = (await as(U_OK, `select public.rm_price_jump_lines('${LE}') r`))[0].r;
ok(j.ok === true && j.rows.map((x) => x.id).join() === fasitJump.join(), "rm_price_jump_lines = dagens Prishopp-rader");
ok(j.rows[0].rm_name === "Mel" && "invoice_number" in j.rows[0] && "expected_price_per_base_unit" in j.rows[0], "prishopp har varenavn og fakturafelt");
const u = (await as(U_OK, `select public.rm_unread_invoices('${LE}') r`))[0].r;
ok(u.rows.map((x) => x.id).join() === fasitUnread.join(), "rm_unread_invoices = dagens Ikke lest-rader");
ok(u.rows.find((x) => x.id === iMis).line_count === 1, "antall linjer følger med");
ok((await as(U_OWNER, `select public.rm_unread_invoices('${LE}') r`))[0].r.rows.length === 2, "eier ser samme som i dag");
ok(await fails(U_NO, `select public.rm_price_jump_lines('${LE}')`, /Ingen fakturatilgang/), "uten fakturatilgang: avvist (ikke tom liste)");
ok(await fails(U_OK, `select public.rm_unread_invoices('${LE2}')`, /Ingen fakturatilgang/), "annet selskap: avvist");
const nav = (await as(U_NO, `select public.rm_nav_counts('${LE}') r`))[0].r;
ok(nav.datasheet_changes === 1 && nav.agreements_expiring_30d === 1 && nav.stock_below_min === 1, "menyens tre merker");
ok(await fails(U_OK, `select public.rm_nav_counts('${LE2}')`, /Ingen tilgang/), "meny: annet selskap avvist");
const rerun = async (f) => { try { await db.exec(read(f)); return ""; } catch (e) { await db.exec("rollback"); return String(e.message); } };
ok(/allerede kjørt/.test(await rerun("kjort/02_raske_oppslag_del1.sql")), "del 1 kan ikke kjøres to ganger");

// DEL 2 – samme synlige rader for alle brukere, også via nestede spørringer.
await db.exec(read("kjort/03_raske_oppslag_del2_rls.sql"));
const after = { ok: await visible(U_OK), owner: await visible(U_OWNER), no: await visible(U_NO) };
ok(JSON.stringify(after) === JSON.stringify(before), "radsikkerhet: nøyaktig samme synlige fakturaer og linjer før og etter");
ok(before.no.inv === "" && before.no.lines === "", "uten tilgang ser ingenting (før og etter)");
ok(!before.ok.inv.includes(iOther), "annet selskap er skjult");
ok((await as(U_OK, directJump)).map((x) => x.id).join() === fasitJump.join(), "Prishopp via direkte lesing gir samme rader etter del 2");
const callsAfter = await calls("select count(*) from invoice_lines");
// Flere linjer: før økte kallene med hver linje; nå skal antallet være uavhengig av antall linjer.
await db.exec(`insert into invoice_lines (invoice_id, requires_review) select '${iOpen}', false from generate_series(1, 200)`);
const callsAfterMany = await calls("select count(*) from invoice_lines");
ok(callsAfterMany === callsAfter && callsAfter < callsBefore, `tilgangskall uavhengig av antall linjer: ${callsBefore} før (8 linjer), ${callsAfter} etter (8 linjer), ${callsAfterMany} etter (208 linjer)`);
console.log(`  tilgangskall: før ${callsBefore} (8 linjer) · etter ${callsAfter} (8 linjer) · etter ${callsAfterMany} (208 linjer)`);
await db.exec(`delete from invoice_lines where invoice_id = '${iOpen}' and requires_review = false and price_variance_pct is null`);
const pol = (await db.query("select qual from pg_policies where tablename = 'invoice_lines' and policyname = 'invoice_lines_select'")).rows[0].qual;
ok(/rm_invoice_read_entity_ids/.test(pol), "ny policy på invoice_lines");
ok(/allerede kjørt/.test(await rerun("kjort/03_raske_oppslag_del2_rls.sql")), "del 2 kan ikke kjøres to ganger");
// Vakt: endret policy før kjøring stopper filen.
const db2 = new PGlite(); await db2.exec(stub);
await db2.exec("drop policy invoices_select on invoices; create policy invoices_select on invoices for select using (true);");
try { await db2.exec(read("kjort/03_raske_oppslag_del2_rls.sql")); ok(false, "vakt"); } catch (e) { ok(/endret siden 18.11/.test(e.message), "vakt stopper ved endret policy"); }

await printFingerprint(db);
console.log(`OK – ${n} kontroller`);
