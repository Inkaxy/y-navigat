// EHF-bryteren: kjører 20261122 (opplæring) + kjort/02_ehf_forst + 1-kjor-na/02_ehf_bryter mot innebygd PostgreSQL (PGlite)
// med samme stubber som test-fakturalesing-sql.mjs. Kontrollerer at svaret har ehf_first, at bare godkjenner kan lagre,
// revisjonsvakt, at de andre lesebryterne ikke røres begge veier, revisjonslogg og kontrollfilen. Rører aldri live.
// Bruk: node scripts/test-ehf-bryter-sql.mjs   (SQL_EOL=crlf simulerer innliming fra Windows)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const eol = process.env.SQL_EOL === "crlf" ? (s) => s.replace(/\r?\n/g, "\r\n") : (s) => s;
const read = (p) => eol(readFileSync(join(root, p), "utf8"));
const base = readFileSync(join(root, "scripts/test-fakturalesing-sql.mjs"), "utf8");
const stub = base.slice(base.indexOf("const stub = `") + 14, base.indexOf("`;", base.indexOf("const stub = `")));

const LE = "00000000-0000-0000-0000-0000000000a1";
const U = "00000000-0000-0000-0000-0000000000e1";
let ok = 0;
const expect = (c, m) => { if (!c) { console.error("FEIL:", m); process.exit(1); } ok++; };
const db = new PGlite();
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const as = async (level) => { await db.exec(`select set_config('test.uid', '${U}', false), set_config('test.level', '${level}', false)`); };

await db.exec(stub);
await db.exec(`insert into legal_entities values ('${LE}')`);
await db.exec(read("supabase/pending/kjort/20261122_fakturalesing_opplaering.PENDING.sql"));
await db.exec(read("supabase/pending/kjort/02_ehf_forst.sql"));
await db.exec(read("supabase/pending/1-kjor-na/02_ehf_bryter.sql"));
await as("approve");

let s = (await one(`select public.rm_reading_settings($1) as r`, [LE])).r;
expect(s.ehf_first === false && s.revision === 0, "uten rad: ehf_first=false, revisjon 0");

// De andre bryterne lagres først; EHF skal ikke røre dem.
let r = (await one(`select public.rm_save_reading_settings($1, '{"catalog":true,"learning":true,"max_examples":5}'::jsonb, 0) as r`, [LE])).r;
expect(r.ok === true && r.revision === 1, "vanlig lagring virker");
r = (await one(`select public.rm_save_ehf_first($1, true, 1) as r`, [LE])).r;
expect(r.ok === true && r.revision === 2, "EHF på lagres");
s = (await one(`select public.rm_reading_settings($1) as r`, [LE])).r;
expect(s.ehf_first === true && s.catalog === true && s.learning === true && s.max_examples === 5 && s.profile === false, "EHF på, andre brytere uendret");

// Vanlig lagring uten ehf_first skal ikke slå EHF av.
r = (await one(`select public.rm_save_reading_settings($1, '{"catalog":false}'::jsonb, 2) as r`, [LE])).r;
expect(r.ok === true, "vanlig lagring etter EHF");
s = (await one(`select public.rm_reading_settings($1) as r`, [LE])).r;
expect(s.ehf_first === true && s.catalog === false, "vanlig lagring rører ikke EHF");

r = (await one(`select public.rm_save_ehf_first($1, false, 2) as r`, [LE])).r;
expect(r.ok === false && r.code === "endret" && r.revision === 3, "gammel revisjon avvises");
r = (await one(`select public.rm_save_ehf_first($1, null, 3) as r`, [LE])).r;
expect(r.ok === false && r.code === "ugyldig", "null avvises");

await as("write");
let denied = false;
try { await one(`select public.rm_save_ehf_first($1, false, 3) as r`, [LE]); } catch { denied = true; }
expect(denied, "vanlig skrivetilgang kan ikke lagre EHF");
await as("approve");
s = (await one(`select public.rm_reading_settings($1) as r`, [LE])).r;
expect(s.ehf_first === true && s.revision === 3, "avvisninger endret ingenting");

r = (await one(`select public.rm_save_ehf_first($1, false, 3) as r`, [LE])).r;
expect(r.ok === true && r.revision === 4, "EHF av lagres");
const log = await one(`select count(*)::int n, bool_and((changes->'after'->>'ehf_first') is not null) a from audit_log where action = 'invoice_reading.ehf_first_saved'`);
expect(log.n === 2 && log.a, "to EHF-lagringer i revisjonsloggen");

// Ny rad via EHF-lagring (annet selskap) gir standardverdier for resten.
const LE2 = "00000000-0000-0000-0000-0000000000a2";
await db.exec(`insert into legal_entities values ('${LE2}')`);
r = (await one(`select public.rm_save_ehf_first($1, true, 0) as r`, [LE2])).r;
s = (await one(`select public.rm_reading_settings($1) as r`, [LE2])).r;
expect(r.ok && s.ehf_first === true && s.catalog === false && s.max_examples === 8, "ny rad: bare EHF på");

const cr = await one(`select count(*)::int n from pg_proc where proname in ('rm_reading_settings','rm_save_ehf_first') and strpos(prosrc, chr(13)) > 0`);
expect(cr.n === 0, "ingen CR i funksjonene");
const checks = (await db.query(read("supabase/pending/kontroll/20261127_ehf_bryter.check.sql"))).rows;
expect(checks.length === 4 && checks.every((c) => c.ok === true), "kontrollfilen: alle ok");

console.log(`OK ${ok} kontroller (${process.env.SQL_EOL === "crlf" ? "CRLF" : "LF"})`);
