// Innliming med Windows-linjeskift: kjører hver databasetest som berører 00–07 (kjørt 18.11, nå i kjort/), 2-endrer-data og kontroll to ganger
// – med filene som de ligger (LF) og som limt inn med CR+LF – og krever samme resultat: testene består begge ganger,
// og funksjonsdefinisjoner/policyer er identiske og uten CR. Tester også 00_test_innliming og 06 (e-postmalen) direkte.
// «Slå sammen varer» (05) og delfilene testes med CR+LF i src/test/splitPendingSql.test.ts.
// Bruk: node scripts/test-innliming-crlf.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const crlf = (s) => s.replace(/\r?\n/g, "\r\n");
let ok = 0;
const expect = (c, m) => { if (!c) { console.error("FEIL:", m); process.exit(1); } ok++; };

const SCRIPTS = [
  ["test-gjenlesing-fjern-sql.mjs", "01 + kontroll"],
  ["test-raske-oppslag-sql.mjs", "02, 03"],
  ["test-variantb-sql.mjs", "04"],
  ["test-lesevarsel-sql.mjs", "07"],
  ["test-frafaktura-sql.mjs", "2-endrer-data: fra_faktura_opprydding"],
  ["test-godta-sum-sql.mjs", "2-endrer-data: sumkontroll_omregning (+ dryrun)"],
  ["test-nye-varer-sql.mjs", "kontroll: nye_varer_les"],
  ["test-kobling-godkjent-sql.mjs", "kontroll: kobling_godkjent_faktura"],
  ["test-fakturalesing-sql.mjs", "kontroll: fakturalesing_opplaering"],
];

for (const [script, what] of SCRIPTS) {
  const run = (eol) => {
    let out;
    try {
      out = execFileSync(process.execPath, [join(root, "scripts", script)], { env: { ...process.env, SQL_EOL: eol }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      console.error(String(e.stdout ?? "") + String(e.stderr ?? ""));
      expect(false, `${script} feilet med ${eol.toUpperCase()}`);
    }
    const line = out.split("\n").find((l) => l.startsWith("FINGERAVTRYKK "));
    expect(Boolean(line), `${script} skrev ikke fingeravtrykk (${eol})`);
    return JSON.parse(line.slice("FINGERAVTRYKK ".length));
  };
  const lf = run("lf"), cr = run("crlf");
  expect(JSON.stringify(lf) === JSON.stringify(cr), `${script}: ulikt resultat LF ${JSON.stringify(lf)} / CRLF ${JSON.stringify(cr)}`);
  expect(cr.cr_i_funksjoner === 0 && cr.cr_rader === 0, `${script}: CR ligger igjen i databasen ${JSON.stringify(cr)}`);
  console.log(`  ${script.padEnd(30)} ${what.padEnd(46)} LF = CRLF  funksjoner ${cr.funksjoner.slice(0, 8)}  policyer ${cr.policyer.slice(0, 8)}`);
}

// 00: ren SELECT. Med LF «ok»; med CR+LF ser vi har_cr = true og «ikke ok», men «etter_rensing» = ok.
const t00 = readFileSync(join(root, "supabase/pending/kjort/00_test_innliming.sql"), "utf8");
const q00 = async (sql) => { const db = new PGlite(); const r = (await db.query(sql)).rows; await db.close(); return r; };
const a = await q00(t00), b = await q00(crlf(t00));
expect(a.length === 1 && a[0].resultat === "ok" && a[0].etter_rensing === "ok" && !a[0].har_cr && a[0].har_tab && !a[0].har_nbsp, `00 LF: ${JSON.stringify(a)}`);
expect(a[0].md5 === a[0].forventet_md5 && a[0].lengde === a[0].forventet_lengde, "00 LF: md5 og lengde som forventet");
expect(b.length === 1 && b[0].har_cr && b[0].resultat === "ikke ok" && b[0].etter_rensing === "ok", `00 CRLF: ${JSON.stringify(b)}`);
const c = await q00(t00.replace("\ttabulator", "    tabulator"));
expect(!c[0].har_tab && c[0].resultat === "ikke ok", "00: tabulator gjort om til mellomrom oppdages");
console.log("  00_test_innliming.sql          LF = ok · CRLF = har_cr/ikke ok, etter_rensing ok · tabulator→mellomrom oppdages");

// 06: e-postmalen. Ingen flerlinjet tekst i filen, så raden blir lik med LF og CR+LF.
const t06 = readFileSync(join(root, "supabase/pending/kjort/06_varselmal_lesing_stopper.sql"), "utf8");
const row06 = async (sql) => {
  const db = new PGlite();
  await db.exec(`create table public.email_templates (template_key text primary key, display_name text, subject_template text,
    body_html_template text, body_text_template text, available_variables jsonb, is_active boolean);`);
  await db.exec(sql);
  const r = (await db.query(`select to_jsonb(t)::text j from public.email_templates t`)).rows;
  await db.close();
  return r;
};
const r1 = await row06(t06), r2 = await row06(crlf(t06));
expect(r1.length === 1 && JSON.stringify(r1) === JSON.stringify(r2) && !r2[0].j.includes("\\r"), "06: samme mal med LF og CR+LF");
console.log("  06_varselmal_lesing_stopper.sql LF = CRLF (samme rad, ingen CR)");

// Motprøve: uten sluttsteget som skriver funksjonene på nytt med LF, blir CR liggende i funksjonskroppen (07).
const t07 = readFileSync(join(root, "supabase/pending/kjort/07_lesevarsel_stillstand.sql"), "utf8");
const cr07 = async (sql) => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table invoices (id uuid primary key default gen_random_uuid(), line_extraction_status text, line_extraction_at timestamptz);
    create table email_templates (template_key text primary key, is_active boolean);
    create table email_outbox (id uuid primary key default gen_random_uuid(), template_key text, recipient_email text, related_entity_type text,
      variables jsonb default '{}', created_at timestamptz default now());`);
  await db.exec(sql);
  const n = Number((await db.query(`select count(*)::int n from pg_proc where strpos(prosrc, chr(13)) > 0`)).rows[0].n);
  await db.close();
  return n;
};
const without = t07.replace(/-- Linjeskift: limes filen inn[\s\S]*?end \$lf\$;\n/, "");
expect(without !== t07, "07 har sluttsteget");
expect((await cr07(crlf(without))) > 0, "motprøve: uten sluttsteg får funksjonen CR ved CR+LF-innliming");
expect((await cr07(crlf(t07))) === 0, "med sluttsteg: ingen CR");
console.log("  motprøve 07                    uten sluttsteg: CR i funksjonen · med sluttsteg: ingen CR");

console.log(`OK – ${ok} kontroller (LF og CR+LF gir samme resultat)`);
