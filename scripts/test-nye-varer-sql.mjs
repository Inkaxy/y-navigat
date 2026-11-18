// «Fra faktura › Nye varer»: kjører 20261119_nye_varer_les.PENDING.sql mot innebygd PostgreSQL (PGlite) sammen med
// live-definisjonen av rm_work_items fra 17.11 (byte-identisk kopi) etter 20261121_kobling_godkjent_faktura, og kontrollerer at den nye funksjonen gir
// nøyaktig samme rader, tellere og rekkefølge som rm_work_items (gruppene kobling + pakning). Rører aldri live.
// Bruk: node scripts/test-nye-varer-sql.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { readSql, printFingerprint } from "./lib/pastedSql.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readSql(join(root, p));
const pending = read("supabase/pending/kjort/20261119_nye_varer_les.PENDING.sql");
const live = read("scripts/fixtures/live-20261117/rm_work_items.sql");
// Samme regel som koblingen (20261121_kobling_godkjent_faktura) gjelder begge køfunksjonene; filen kjøres derfor her også.
const kobling = read("supabase/pending/kjort/20261121_kobling_godkjent_faktura.PENDING.sql");
const koblingFx = ["rm_confirm_line_match", "rm_link_supplier_item", "rm_undo_not_item", "rm_set_invoice_exclusion"]
  .map((n) => read(`scripts/fixtures/live-20261117b/${n}.sql`)).join(";\n");

const stub = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function public.has_ravarer_invoice_access(uuid, text) returns boolean language sql stable as $$ select current_setting('test.read', true) is distinct from 'nei' $$;
create function public.rm_sku_norm(p text) returns text language sql immutable as $$ select lower(regexp_replace(coalesce(p,''), '[^a-zA-Z0-9]', '', 'g')) $$;
create function public.rm_match_key(p text) returns text language sql immutable as $$ select lower(regexp_replace(btrim(coalesce(p,'')), '\\s+', ' ', 'g')) $$;
create function public.rm_invoice_has_read_issues(uuid) returns boolean language sql stable as $$ select false $$;
create function public._rm_queue_line_read_issue(uuid, boolean) returns text language sql stable as $$ select null::text $$;
create function public._rm_queue_line_effect(uuid, boolean) returns numeric language sql stable as $$ select null::numeric $$;
create table suppliers (id uuid primary key, legal_entity_id uuid, name text);
create table raw_materials (id uuid primary key, legal_entity_id uuid, name text);
create table invoices (id uuid primary key, legal_entity_id uuid, supplier_id uuid, status text, flagged_at timestamptz, excluded_at timestamptz,
  invoice_number text, invoice_date date, total_amount numeric, is_credit_note boolean default false, currency text default 'NOK',
  lines_sum_status text default 'ok', flag_reason text);
create table invoice_lines (id uuid primary key, invoice_id uuid, created_at timestamptz, supplier_sku text, description text, raw_material_id uuid,
  match_confidence text, requires_review boolean, review_reason text, total_amount numeric, base_quantity numeric,
  price_per_base_unit numeric, expected_price_per_base_unit numeric, excluded_at timestamptz);
create table invoice_line_cost_postings (invoice_line_id uuid, revoked_at timestamptz);
`;

const LE = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000a2";
const id = (p, n) => `00000000-0000-0000-${p}-${String(n).padStart(12, "0")}`;
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pickOf = (a) => a[Math.floor(rnd() * a.length)];

let ok = 0;
const fail = (m) => { console.error("FEIL:", m); process.exit(1); };
const check = (cond, m) => { if (!cond) fail(m); ok++; };
const db = new PGlite();
const step = async (name, fn) => { try { return await fn(); } catch (e) { fail(`${name}: ${e.message}`); } };
const one = async (sql) => (await db.query(sql)).rows[0];

await step("stubb", () => db.exec(stub));
await step("live rm_work_items", () => db.exec(live));
await step("PENDING", () => db.exec(pending));
await step("dagens koblingsfunksjoner", () => db.exec(koblingFx));
await step("20261121_kobling_godkjent_faktura", () => db.exec(kobling));

// Testdata: 4 leverandører, 12 råvarer, 120 fakturaer, ca. 600 linjer med blandet status/kobling/årsak.
const sups = [1, 2, 3, 4].map((n) => id("0001", n));
const rms = Array.from({ length: 12 }, (_, i) => id("0002", i + 1));
const names = ["HVETEMEL SIKTET 25KG", "Hvetemel siktet 25 kg", "SMØR USALTET", "MILJØGEBYR", "BAKEPAPIR 40X60", "Kakeeske 20x20",
  "SJOKOSTRØSSEL MØRK 5KG", "MANDELMASSE 50%", "EGG M", "PANT", "FRAKT", "SUKKER 25KG", "GJÆR", "ROSINER"];
const reasons = [null, "unmatched", "unknown_package_size", "price_variance", "no_automatic_basis", "uncertain_cost", "sku_collision", "price_variance,unknown_package_size"];
const statuses = ["imported", "needs_review", "ready", "reconciled", "cancelled", "excluded"];
const confs = ["manual", "auto_high", "auto_medium", "auto_low", "unmatched", "not_applicable", null];
let sql = `insert into suppliers values ${sups.map((s, i) => `('${s}','${LE}','Leverandør ${i + 1}')`).join(",")};
insert into raw_materials values ${rms.map((r, i) => `('${r}','${LE}','Vare ${i + 1}')`).join(",")};\n`;
const invs = [];
for (let i = 1; i <= 120; i++) {
  const inv = id("0003", i);
  invs.push(inv);
  const st = pickOf(statuses);
  const le = i === 120 ? OTHER : LE;
  const day = String(1 + Math.floor(rnd() * 28)).padStart(2, "0");
  const month = pickOf(["09", "10", "11"]);
  sql += `insert into invoices (id, legal_entity_id, supplier_id, status, flagged_at, excluded_at, invoice_number, invoice_date, total_amount) values
    ('${inv}','${le}','${pickOf(sups)}','${st}',${rnd() < 0.08 ? "now()" : "null"},${rnd() < 0.04 ? "now()" : "null"},'F${i}','2026-${month}-${day}',${Math.round(rnd() * 5000)});\n`;
}
let ln = 0;
for (const inv of invs) {
  const n = 1 + Math.floor(rnd() * 8);
  for (let k = 0; k < n; k++) {
    ln++;
    const nm = pickOf(names);
    const sku = rnd() < 0.55 ? `'${pickOf(["100917", "20411", "A-77", "5540", "x 12"])}'` : "null";
    const conf = pickOf(confs);
    const rm = conf && !["unmatched", "not_applicable"].includes(conf) && rnd() < 0.9 ? `'${pickOf(rms)}'` : "null";
    const rr = rnd() < 0.6;
    const reason = rr ? pickOf(reasons) : null;
    sql += `insert into invoice_lines values ('${id("0004", ln)}','${inv}', timestamptz '2026-11-01' + interval '${ln} minutes', ${sku}, '${nm}', ${rm},
      ${conf ? `'${conf}'` : "null"}, ${rr}, ${reason ? `'${reason}'` : "null"}, ${Math.round(rnd() * 900)}, 1, 1, null, ${rnd() < 0.03 ? "now()" : "null"});\n`;
  }
}
// Annet selskap har alltid minst én åpen, ukoblet linje (ellers er sammenligningen nedenfor tom).
sql += `update invoices set status = 'needs_review', flagged_at = null, excluded_at = null where id = '${invs[119]}';
insert into invoice_lines values ('${id("0004", ln + 1)}','${invs[119]}', timestamptz '2026-11-02', null, 'ANNET SELSKAP VARE', null, 'unmatched', true, 'unmatched', 10, 1, 1, null, null);\n`;
await step("data", () => db.exec(sql));

const wi = async (sup) => (await one(`select public.rm_work_items('${LE}', 'alle', null, ${sup ? `'${sup}'` : "null"}, 'oldest', 500, 0) r`)).r;
const ny = async (sup, limit = 200, offset = 0) => (await one(`select public.rm_new_items_queue('${LE}', ${sup ? `'${sup}'` : "null"}, ${limit}, ${offset}) r`)).r;
const strip = (it) => ({ key: it.key, grp: it.grp, kind: it.kind, supplier_id: it.supplier_id, item_key: it.item_key, title: it.title, sku: it.sku,
  rm_id: it.rm_id, rm_name: it.rm_name, open_lines: Number(it.open_lines), open_invoices: Number(it.open_invoices), invoice_count: Number(it.invoice_count),
  amount: Number(it.amount), last_date: it.last_date, first_open_date: it.first_open_date, last_open_line_id: it.last_open_line_id,
  reasons: [...(it.reasons ?? [])].sort() });

for (const sup of [null, ...sups]) {
  const a = await wi(sup);
  const b = await ny(sup);
  const exp = a.items.filter((x) => x.grp === "kobling" || x.grp === "pakning").map(strip);
  const got = b.items.map(strip);
  const label = sup ? `leverandør ${sups.indexOf(sup) + 1}` : "alle";
  check(exp.length > 0 || sup, `${label}: testdata gir rader`);
  check(Number(b.total) === exp.length, `${label}: total ${b.total} ≠ ${exp.length}`);
  check(JSON.stringify(got) === JSON.stringify(exp), `${label}: rader/rekkefølge avviker fra rm_work_items`);
  if (!sup) {
    check(Number(b.counts.kobling) === Number(a.counts.kobling), `kobling ${b.counts.kobling} ≠ ${a.counts.kobling}`);
    check(Number(b.counts.pakning) === Number(a.counts.pakning), `pakning ${b.counts.pakning} ≠ ${a.counts.pakning}`);
    check(Number(b.counts.alle) === Number(a.counts.kobling) + Number(a.counts.pakning), "alle = kobling + pakning");
    const perSup = b.suppliers.reduce((s, x) => s + Number(x.count), 0);
    check(perSup === Number(b.counts.alle), "leverandørtallene summerer til alle");
  } else {
    const all = await ny(null, 0);
    const chip = all.suppliers.find((x) => x.supplier_id === sup);
    check(Number(chip?.count ?? 0) === exp.length, `${label}: chip-tallet stemmer`);
    check(JSON.stringify(b.counts) === JSON.stringify(all.counts), `${label}: fanetellerne er uavhengige av filteret`);
  }
}

// Sidevis: to sider à 7 gir de samme radene som én stor side.
const full = (await ny(null, 200, 0)).items.map((x) => x.key);
const p1 = (await ny(null, 7, 0)).items.map((x) => x.key);
const p2 = (await ny(null, 7, 7)).items.map((x) => x.key);
check(JSON.stringify([...p1, ...p2]) === JSON.stringify(full.slice(0, 14)), "sidevis henting gir samme rekkefølge");
check((await ny(null, 0)).items.length === 0, "p_limit 0 gir bare tellere");
check((await ny(null, 5000)).items.length <= 200, "maks 200 per side");

// Tilgang: innlogget uten lesetilgang avvises.
await db.exec(`select set_config('test.uid', '00000000-0000-0000-0000-0000000000e1', false); select set_config('test.read', 'nei', false);`);
let denied = false;
try { await ny(null); } catch (e) { denied = /Ingen fakturatilgang/.test(e.message); }
check(denied, "uten lesetilgang avvises kallet");
await db.exec(`select set_config('test.read', '', false);`);
check(Number((await ny(null)).total) >= 0, "med tilgang virker kallet");

// Annet selskap: egne tall, samme som rm_work_items for det selskapet, og ingen av dets linjer i vårt svar.
const o1 = (await one(`select public.rm_new_items_queue('${OTHER}', null, 200, 0) r`)).r;
const o2 = (await one(`select public.rm_work_items('${OTHER}', 'alle', null, null, 'oldest', 500, 0) r`)).r;
check(Number(o1.counts.alle) === Number(o2.counts.kobling) + Number(o2.counts.pakning) && Number(o1.counts.alle) > 0, "annet selskap har egne, like tall");
const ourOpen = new Set((await ny(null)).items.map((x) => x.last_open_line_id).filter(Boolean));
check(o1.items.every((x) => !x.last_open_line_id || !ourOpen.has(x.last_open_line_id)), "ingen linjer fra annet selskap i vårt svar");
check((await one(`select public.rm_cap_nye_varer_v1() c`)).c === true, "cap");

console.log(`OK: ${ok} kontroller bestått`);

// Kontrollfilen kjører og gir bare «ok» på testkopien (selskaps-ID byttet til testselskapet).
await db.exec(`select set_config('test.uid', '', false);`);
const checkSql = read("supabase/pending/kontroll/20261119_nye_varer_les.check.sql").replaceAll("751709bc-04b3-4449-867d-b97faa9ab373", LE);
const checkRows = (await step("check.sql", () => db.query(checkSql))).rows;
check(checkRows.length === 8 && checkRows.every((r) => r.ok === true), `check.sql: ${JSON.stringify(checkRows.filter((r) => r.ok !== true))}`);
await printFingerprint(db);
console.log(`OK: ${ok} kontroller bestått (med check.sql)`);
