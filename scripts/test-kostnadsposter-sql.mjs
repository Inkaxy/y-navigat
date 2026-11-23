// Kostnadsposter: kjører 1-kjor-na/02_kostnadsposter.sql mot innebygd PostgreSQL (PGlite) med samme stubber som
// test-fakturalesing-sql.mjs. Kontrollerer tilgang, opprett/gi nytt navn/arkiver, regel per leverandørlinje (gjelder nye
// fakturaer automatisk), årssum per post/leverandør/linje, forslag, ukjent beløp, linjelisten og kontrollfilen. Rører aldri live.
// Bruk: node scripts/test-kostnadsposter-sql.mjs   (SQL_EOL=crlf simulerer innliming fra Windows)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { readSql, printFingerprint } from "./lib/pastedSql.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readSql(join(root, p));
const base = readFileSync(join(root, "scripts/test-fakturalesing-sql.mjs"), "utf8");
const stub = base.slice(base.indexOf("const stub = `") + 14, base.indexOf("`;", base.indexOf("const stub = `")));

const LE = "00000000-0000-0000-0000-0000000000a1";
const LE2 = "00000000-0000-0000-0000-0000000000a2";
const U = "00000000-0000-0000-0000-0000000000e1";
const DRAM = "00000000-0000-0000-0000-0000000000d1";
const ASKO = "00000000-0000-0000-0000-0000000000d2";
let ok = 0;
const expect = (c, m) => { if (!c) { console.error("FEIL:", m); process.exit(1); } ok++; };
const db = new PGlite();
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const as = async (level) => { await db.exec(`select set_config('test.uid', '${U}', false), set_config('test.level', '${level}', false)`); };
const fails = async (sql, params) => { try { await db.query(sql, params); return false; } catch { return true; } };

await db.exec(stub);
await db.exec(`alter table invoices add column excluded_at timestamptz, add column line_extraction_status text default 'done'`);
await db.exec(`insert into legal_entities values ('${LE}'), ('${LE2}');
  insert into suppliers (id, legal_entity_id, name) values ('${DRAM}', '${LE}', 'Drammen Papir Engros AS'), ('${ASKO}', '${LE}', 'ASKO ØST AS');
  insert into invoices (id, legal_entity_id, supplier_id, invoice_number, invoice_date) values
    ('00000000-0000-0000-0000-000000000101', '${LE}', '${DRAM}', 'D1', '2026-03-01'),
    ('00000000-0000-0000-0000-000000000102', '${LE}', '${DRAM}', 'D2', '2026-10-15'),
    ('00000000-0000-0000-0000-000000000103', '${LE}', '${ASKO}', 'A1', '2026-05-05'),
    ('00000000-0000-0000-0000-000000000104', '${LE}', '${DRAM}', 'D0', '2025-12-31');
  update invoices set line_extraction_status = 'pending' where invoice_number = 'A1';
  insert into invoice_lines (id, invoice_id, description, supplier_sku, total_amount, line_kind) values
    ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'Miljøvederlag kg ( per 1,00 KG )', null, 40, 'gebyr'),
    ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000102', 'Miljøvederlag kg ( per 1,00 KG )', null, 60.5, 'gebyr'),
    ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000102', 'Frakt', null, 390, 'frakt'),
    ('00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-000000000103', 'Frakttillegg', 'FR-01', 150, 'frakt'),
    ('00000000-0000-0000-0000-000000000205', '00000000-0000-0000-0000-000000000103', 'Mel', '123', 999, 'vare'),
    ('00000000-0000-0000-0000-000000000206', '00000000-0000-0000-0000-000000000104', 'Miljøvederlag kg ( per 1,00 KG )', null, 25, 'gebyr');`);
await db.exec(read("supabase/pending/1-kjor-na/02_kostnadsposter.sql"));

const MILJO = "name:miljøvederlag kg per 1 00 kg";
await as("read");
expect(await fails(`select public.rm_save_cost_post($1, null, 'Frakt')`, [LE]), "lesetilgang kan ikke opprette post");
expect(await fails(`select public.rm_set_cost_post_rule($1, $2, $3, null)`, [LE, DRAM, MILJO]), "lesetilgang kan ikke endre regel");
await as("none");
expect(await fails(`select public.rm_cost_post_summary($1, 2026)`, [LE]), "uten tilgang: ingen oversikt");

await as("write");
let r = (await one(`select public.rm_save_cost_post($1, null, '  Miljøvederlag ') r`, [LE])).r;
expect(r.ok && r.name === "Miljøvederlag" && r.existed === false, "opprett post, navnet renses");
const miljo = r.id;
r = (await one(`select public.rm_save_cost_post($1, null, 'miljøvederlag') r`, [LE])).r;
expect(r.ok && r.id === miljo && r.existed === true, "samme navn gir samme post");
r = (await one(`select public.rm_save_cost_post($1, null, 'Frakt') r`, [LE])).r;
const frakt = r.id;
r = (await one(`select public.rm_save_cost_post($1, $2, 'Miljøvederlag', false) r`, [LE, frakt])).r;
expect(!r.ok && r.code === "navn_finnes", "nytt navn som finnes avvises");
r = (await one(`select public.rm_save_cost_post($1, null, '') r`, [LE])).r;
expect(!r.ok && r.code === "ugyldig_navn", "tomt navn avvises");

r = (await one(`select public.rm_set_cost_post_rule($1, $2, $3, $4) r`, [LE, DRAM, MILJO, miljo])).r;
expect(r.ok && r.changed && r.previous_post_id === null, "Miljøvederlag-linjen legges i posten");
r = (await one(`select public.rm_set_cost_post_rule($1, $2, 'name:frakt', $3) r`, [LE, DRAM, frakt])).r;
expect(r.ok, "Frakt fra Drammen legges i Frakt");
r = (await one(`select public.rm_set_cost_post_rule($1, $2, 'name:finnes ikke', $3) r`, [LE, DRAM, frakt])).r;
expect(!r.ok && r.code === "ukjent_linje", "ukjent leverandørlinje avvises");
r = (await one(`select public.rm_set_cost_post_rule($1, $2, 'name:frakt', $3) r`, [LE2, DRAM, frakt])).r;
expect(!r.ok, "annet selskap kan ikke bruke posten");

let s = (await one(`select public.rm_cost_post_summary($1, 2026) r`, [LE])).r;
const pm = s.posts.find((p) => p.id === miljo), pf = s.posts.find((p) => p.id === frakt);
expect(s.ok && s.invoices === 3 && s.unread_invoices === 1, "fakturaer i året og uleste telles");
expect(Number(pm.amount) === 100.5 && pm.lines === 2 && pm.invoices === 2, "Miljøvederlag 2026 = 40 + 60,50 (2025-linjen er utenfor)");
expect(pm.suppliers.length === 1 && pm.suppliers[0].name === "Drammen Papir Engros AS", "leverandøren vises");
expect(pm.items.length === 1 && pm.items[0].lines === 2 && pm.items[0].text.startsWith("Miljøvederlag"), "leverandørlinjen vises");
expect(Number(pf.amount) === 390, "Frakt = 390");
expect(s.suggestions.length === 1 && s.suggestions[0].supplier_name === "ASKO ØST AS" && s.suggestions[0].item_key === "sku:fr01", "ASKOs frakt foreslås, vare foreslås ikke");
s = (await one(`select public.rm_cost_post_summary($1, 2025) r`, [LE])).r;
expect(Number(s.posts.find((p) => p.id === miljo).amount) === 25, "2025 har sin egen sum");

// Ny faktura med samme linje telles automatisk; ukjent beløp er ikke 0.
await db.exec(`insert into invoices (id, legal_entity_id, supplier_id, invoice_number, invoice_date) values ('00000000-0000-0000-0000-000000000105', '${LE}', '${DRAM}', 'D3', '2026-11-20');
  insert into invoice_lines (id, invoice_id, description, total_amount, line_kind) values
   ('00000000-0000-0000-0000-000000000207', '00000000-0000-0000-0000-000000000105', 'Miljøvederlag kg (per 1,00 kg)', 10, 'gebyr'),
   ('00000000-0000-0000-0000-000000000208', '00000000-0000-0000-0000-000000000105', 'Miljøvederlag kg ( per 1,00 KG )', null, 'gebyr');`);
s = (await one(`select public.rm_cost_post_summary($1, 2026) r`, [LE])).r;
const pm2 = s.posts.find((p) => p.id === miljo);
expect(Number(pm2.amount) === 110.5 && pm2.lines === 4 && pm2.missing_amount === 1, "ny faktura telles automatisk, ukjent beløp telles for seg");

let l = (await one(`select public.rm_cost_post_lines($1, $2, 2026, null) r`, [LE, miljo])).r;
expect(l.ok && l.total === 4 && l.lines[0].invoice_number === "D3", "linjelisten, nyeste først");
l = (await one(`select public.rm_cost_post_lines($1, $2, 2026, $3) r`, [LE, miljo, ASKO])).r;
expect(l.ok && l.total === 0, "filter på leverandør");

// Arkivert post: kan ikke få nye linjer, men vises så lenge den har beløp i året.
r = (await one(`select public.rm_save_cost_post($1, $2, 'Frakt', true) r`, [LE, frakt])).r;
expect(r.ok && r.archived === true, "arkiver post");
r = (await one(`select public.rm_set_cost_post_rule($1, $2, 'sku:fr01', $3) r`, [LE, ASKO, frakt])).r;
expect(!r.ok && r.code === "ukjent_post", "arkivert post tar ikke nye linjer");
s = (await one(`select public.rm_cost_post_summary($1, 2026) r`, [LE])).r;
expect(s.posts.some((p) => p.id === frakt && p.archived), "arkivert post med beløp vises");
s = (await one(`select public.rm_cost_post_summary($1, 2024) r`, [LE])).r;
expect(!s.posts.some((p) => p.id === frakt), "arkivert post uten beløp vises ikke");

r = (await one(`select public.rm_set_cost_post_rule($1, $2, $3, null) r`, [LE, DRAM, MILJO])).r;
expect(r.ok && r.previous_post_id === miljo, "ta linjen ut av posten");
s = (await one(`select public.rm_cost_post_summary($1, 2026) r`, [LE])).r;
expect(s.posts.find((p) => p.id === miljo).lines === 0, "posten er tom igjen");

const log = await one(`select count(*)::int n from audit_log where action like 'cost_post.%'`);
expect(log.n >= 6, "endringene står i revisjonsloggen");
const cr = await one(`select count(*)::int n from pg_proc where proname like '%cost_post%' and strpos(prosrc, chr(13)) > 0`);
expect(cr.n === 0, "ingen CR i funksjonene");
const checks = (await db.query(read("supabase/pending/kontroll/20261128_kostnadsposter.check.sql"))).rows;
expect(checks.length === 6 && checks.every((c) => c.ok === true), `kontrollfilen: alle ok ${JSON.stringify(checks)}`);
expect(await fails(read("supabase/pending/1-kjor-na/02_kostnadsposter.sql")), "filen nekter å kjøre to ganger");

await printFingerprint(db);
console.log(`OK ${ok} kontroller (${process.env.SQL_EOL === "crlf" ? "CRLF" : "LF"})`);
