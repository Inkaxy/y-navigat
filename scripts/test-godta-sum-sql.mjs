// «Fra faktura › Ikke lest»: kjører 20261119_godta_sum.PENDING.sql og 20261119_sumkontroll_omregning (dry-run og
// DATAENDRING) mot innebygd PostgreSQL (PGlite) med byte-identisk kopi av live rm_lines_sum_check. Rører aldri live.
// Bruk: node scripts/test-godta-sum-sql.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const LE = "751709bc-04b3-4449-867d-b97faa9ab373";
const U = "00000000-0000-0000-0000-0000000000e1";
const id = (p, n) => `00000000-0000-0000-${p}-${String(n).padStart(12, "0")}`;

let ok = 0;
process.on("uncaughtException", (e) => { console.error("FEIL:", e.message, e.position ?? ""); process.exit(1); });
const fail = (m) => { console.error("FEIL:", m); process.exit(1); };
const check = (c, m) => { if (!c) fail(m); ok++; };
const db = new PGlite();
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const as = async (uid, write = true) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false); select set_config('test.write', '${write ? "" : "nei"}', false);`);

await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function public.has_ravarer_invoice_access(uuid, text) returns boolean language sql stable as $$ select $2 = 'read' or current_setting('test.write', true) is distinct from 'nei' $$;
create function public.rm_is_finite(numeric) returns boolean language sql immutable as $$ select $1 is not null and $1 <> 'NaN'::numeric $$;
create table invoices (id uuid primary key, legal_entity_id uuid, invoice_number text, invoice_date date default '2026-10-01', status text, excluded_at timestamptz, flagged_at timestamptz,
  reconciled_at timestamptz, total_amount numeric, total_vat numeric, is_credit_note boolean default false, lines_sum_status text,
  lines_sum_excl_vat numeric, lines_sum_variance_pct numeric, notes text, extraction_issues jsonb default '[]', updated_at timestamptz default now(),
  constraint invoices_lines_sum_status_check CHECK ((lines_sum_status = ANY (ARRAY['not_checked'::text, 'ok'::text, 'mismatch'::text, 'no_lines'::text, 'no_total'::text]))));
create function set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 millisecond'); return new; end $$;
create trigger trg_invoices_updated_at before update on invoices for each row execute function set_updated_at();
create table invoice_lines (id uuid primary key, invoice_id uuid, total_amount numeric);
create table invoice_internal_approvals (id uuid primary key default gen_random_uuid(), invoice_id uuid, status text, revoked_at timestamptz);
create table invoice_line_cost_postings (id uuid primary key default gen_random_uuid(), invoice_id uuid, revoked_at timestamptz);
create table audit_log (id uuid primary key default gen_random_uuid(), occurred_at timestamptz default now(), user_id uuid, user_display_name text,
  action text, entity_type text, entity_id uuid, entity_display_reference text, legal_entity_id uuid, outlet_id uuid, changes jsonb, reason text,
  source_app text, ip_address inet, user_agent text);
`);
await db.exec(read("scripts/fixtures/live-20261117/rm_lines_sum_check.sql").replaceAll("end $function$\n", "end $function$;\n"));
await db.exec(read("supabase/pending/kjort/20261119_godta_sum.PENDING.sql"));

// Fakturaer: 1 vanlig avvik, 2 mva-forhold, 3 avstemt, 4 kreditnota (ok med dagens regel), 5 kreditnota med kost ført, 6 «ok».
const inv = (n, o) => `insert into invoices (id, legal_entity_id, invoice_number, status, total_amount, total_vat, is_credit_note, lines_sum_status, lines_sum_excl_vat, extraction_issues, reconciled_at)
  values ('${id("0001", n)}', '${LE}', 'F${n}', '${o.status ?? "needs_review"}', ${o.total}, ${o.vat ?? "null"}, ${o.credit ?? false}, '${o.sum ?? "mismatch"}', ${o.lines ?? "null"}, '${o.issues ?? "[]"}', ${o.reconciled ? "now()" : "null"});`;
await db.exec([
  inv(1, { total: 1250, vat: 250, lines: 960 }),
  inv(2, { total: 1250, vat: 250, lines: 1250, issues: '[{"code":"sumavvik_mva_forhold"}]' }),
  inv(3, { total: 1250, vat: 250, lines: 900, status: "reconciled", reconciled: true }),
  inv(4, { total: 3612, vat: 471, lines: -3141, credit: true }),
  inv(5, { total: 3612, vat: 471, lines: -3141, credit: true }),
  inv(6, { total: 1250, vat: 250, lines: 1000, sum: "ok" }),
  `insert into invoice_lines values ('${id("0002", 1)}','${id("0001", 1)}',960), ('${id("0002", 2)}','${id("0001", 2)}',1250), ('${id("0002", 3)}','${id("0001", 3)}',900),
     ('${id("0002", 4)}','${id("0001", 4)}',-3141), ('${id("0002", 5)}','${id("0001", 5)}',-3141), ('${id("0002", 6)}','${id("0001", 6)}',1000);`,
  `insert into invoice_line_cost_postings (invoice_id) values ('${id("0001", 5)}');`,
].join("\n"));

const upd = async (n) => (await one(`select updated_at::text u from invoices where id = $1`, [id("0001", n)])).u;
const accept = async (n, cat, reason, expected, op) => (await one(`select public.rm_accept_invoice_sum($1, $2, $3, $4, $5) r`, [id("0001", n), cat, reason, expected, op])).r;
const undo = async (audit, op) => (await one(`select public.rm_undo_accept_invoice_sum($1, $2) r`, [audit, op])).r;
const err = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const op1 = "00000000-0000-0000-0000-00000000a001";

// Godta som den er
await as(null);
check(/Ikke innlogget/.test(await err(() => accept(1, "avgift", null, "2026-01-01", op1)) ?? ""), "uten innlogging avvises");
await as(U, false);
check(/skrivetilgang/.test(await err(async () => accept(1, "avgift", null, await upd(1), op1)) ?? ""), "uten skrivetilgang avvises");
await as(U);
check(/Ukjent kategori/.test(await err(async () => accept(1, "tull", null, await upd(1), op1)) ?? ""), "ukjent kategori avvises");
check(/begrunnelse/.test(await err(async () => accept(1, "annet", " ", await upd(1), op1)) ?? ""), "«Annet» krever begrunnelse");
check((await accept(1, "avgift", null, "2020-01-01 00:00:00+00", op1)).code === "endret", "foreldet versjon avvises");
const isoUpd = (await one(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') u from invoices where id = $1`, [id("0001", 1)])).u;
const r1 = await accept(1, "avgift", "Miljøgebyr", isoUpd, op1);
check(r1.ok === true && r1.replay === false, "godta virker med versjon i ISO-form fra nettleseren");
const after1 = await one(`select lines_sum_status, notes from invoices where id = $1`, [id("0001", 1)]);
check(after1.lines_sum_status === "ok" && /Sumavvik godtatt \(Avgifter\/gebyr som ikke er varelinjer\): Miljøgebyr/.test(after1.notes), "status ok og notat på fakturaen");
const a1 = await one(`select * from audit_log where id = $1`, [r1.audit_id]);
check(a1.action === "invoice.sum_accepted" && a1.changes.old.lines_sum_status === "mismatch" && Number(a1.changes.difference) === -40 && a1.user_id === U, "revisjonslogg med gammel verdi og differanse");
const r1b = await accept(1, "avgift", "Miljøgebyr", "2020-01-01", op1);
check(r1b.ok === true && r1b.replay === true && r1b.audit_id === r1.audit_id, "samme op_id gir samme svar");
check(Number((await one(`select count(*) n from audit_log where action = 'invoice.sum_accepted'`)).n) === 1, "ingen dobbel logg ved gjentak");
check((await accept(2, "avgift", null, await upd(2), "00000000-0000-0000-0000-00000000a002")).code === "mva_forhold", "mva-lignende forhold avvises (varselet vaskes ikke bort)");
check((await accept(3, "avgift", null, await upd(3), "00000000-0000-0000-0000-00000000a003")).code === "faktura_last", "avstemt faktura avvises");
check((await accept(6, "avgift", null, await upd(6), "00000000-0000-0000-0000-00000000a006")).code === "ikke_avvik", "faktura uten avvik avvises");

// Angre
const u1 = "00000000-0000-0000-0000-00000000b001";
const r2 = await undo(r1.audit_id, u1);
check(r2.ok === true, "angre virker");
const after2 = await one(`select lines_sum_status, notes from invoices where id = $1`, [id("0001", 1)]);
check(after2.lines_sum_status === "mismatch" && /Godtatt sumavvik angret/.test(after2.notes), "angring gir avvik tilbake og notat");
check((await undo(r1.audit_id, u1)).replay === true, "samme angring på nytt er gjentak");
check((await undo(r1.audit_id, "00000000-0000-0000-0000-00000000b002")).code === "allerede_angret", "kan ikke angres to ganger");
const r3 = await accept(1, "avrunding", null, await upd(1), "00000000-0000-0000-0000-00000000a011");
await db.exec(`update invoices set notes = notes || ' x' where id = '${id("0001", 1)}'`);
const r3u = await undo(r3.audit_id, "00000000-0000-0000-0000-00000000b003");
check(r3u.code === "endret_siden", `angre avvises når fakturaen er endret siden (${JSON.stringify(r3u)} ${JSON.stringify(r3)})`);
check((await one(`select lines_sum_status s from invoices where id = $1`, [id("0001", 1)])).s === "ok", "avvist angring endrer ingenting");

// Dry-run og DATAENDRING (som root: auth.uid() er null).
await as(null);
const before = (await db.query(`select id, lines_sum_status from invoices order by id`)).rows;
const dry = (await db.query(read("supabase/pending/2-endrer-data/20261119_sumkontroll_omregning.dryrun.sql"))).rows;
check(JSON.stringify((await db.query(`select id, lines_sum_status from invoices order by id`)).rows) === JSON.stringify(before), "dry-run endrer ingenting");
const dryOk = dry.filter((r) => r.new_status === "ok").map((r) => r.invoice_number).sort();
check(JSON.stringify(dryOk) === JSON.stringify(["F4", "F5"]), `dry-run viser kreditnotaene som blir ok (${dryOk})`);
// DATAENDRING forventer live-md5; testkopien er byte-identisk.
await db.exec(read("supabase/pending/2-endrer-data/20261119_sumkontroll_omregning.DATAENDRING.sql"));
const st = Object.fromEntries((await db.query(`select invoice_number n, lines_sum_status s from invoices`)).rows.map((r) => [r.n, r.s]));
check(st.F4 === "ok", "kreditnota uten låser blir ok");
check(st.F5 === "mismatch", "kreditnota med ført kost røres ikke");
check(st.F2 === "mismatch" && st.F3 === "mismatch" && st.F6 === "ok", "andre fakturaer røres ikke");
const logs = (await db.query(`select * from audit_log where action = 'invoice.sum_rechecked'`)).rows;
check(logs.length === 1 && logs[0].changes.old.lines_sum_status === "mismatch" && logs[0].changes.new.lines_sum_status === "ok", "omregningen loggføres med gammel og ny verdi");
await db.exec(read("supabase/pending/2-endrer-data/20261119_sumkontroll_omregning.DATAENDRING.sql"));
check((await db.query(`select * from audit_log where action = 'invoice.sum_rechecked'`)).rows.length === 1, "ny kjøring endrer ikke mer");
await db.exec(`create or replace function public.rm_lines_sum_check(p_sum numeric, p_count integer, p_total numeric, p_vat numeric, p_is_credit boolean) returns jsonb language sql immutable as $$ select '{}'::jsonb $$;`);
check(/endret siden 17.11.2026/.test(await err(() => db.exec(read("supabase/pending/2-endrer-data/20261119_sumkontroll_omregning.DATAENDRING.sql"))) ?? ""), "md5-vakten stopper ved endret sumkontroll");

console.log(`OK: ${ok} kontroller bestått`);
