// Deler en stor PENDING-fil i nummererte delfiler på høyst ~15 kB som root kan skrive inn og kjøre én og én.
// Delene 01..N legger bare teksten i en mellomlagringstabell og kontrollerer md5 for akkurat den delen
// (ingen virkning på appen). Siste del («kjør») kontrollerer alle deler og md5 for hele teksten og kjører
// så den gjennomgåtte filen ordrett i ÉN transaksjon – samme SQL som originalen, samme alt-eller-ingenting.
// Bruk: node scripts/splitPendingSql.mjs <sti>/<fil>.PENDING.sql [maks byte per del, standard 13000]; flytt utdatamappen til supabase/pending/delfiler/
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const TAG = "$stage$";
// Innliming fra kodevisning/utklippstavle kan gi CR+LF, hardt mellomrom eller tabulator. Originalen har ingen av dem
// (kontrolleres i splitSql), så teksten renses før lagring og md5 blir den samme uansett hvordan den ble limt inn.
const CLEAN_OPEN = "replace(replace(replace(";
const CLEAN_CLOSE = ", chr(13), ''), chr(160), ' '), chr(9), ' ')";
const md5 = (s) => createHash("md5").update(s, "utf8").digest("hex");
const pad = (n) => String(n).padStart(2, "0");

/** Fjerner filens egen begin/commit (første og siste frittstående linje); resten kjøres ordrett. */
export function bodyOf(text) {
  const lines = text.split("\n");
  const b = lines.findIndex((l) => l.trim().toLowerCase() === "begin;");
  let c = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim().toLowerCase() === "commit;") { c = i; break; }
  if (b < 0 || c < 0 || c <= b) throw new Error("Filen må ha én frittstående «begin;» og «commit;»");
  return [...lines.slice(0, b), ...lines.slice(b + 1, c), ...lines.slice(c + 1)].join("\n");
}

/** Deler på linjeskift slik at hver del er høyst maxBytes (en enkeltlinje over grensen blir egen del). */
export function chunk(body, maxBytes) {
  const out = []; let cur = "";
  for (const line of body.split(/(?<=\n)/)) {
    if (cur && Buffer.byteLength(cur + line, "utf8") > maxBytes) { out.push(cur); cur = ""; }
    cur += line;
  }
  if (cur) out.push(cur);
  return out;
}

/** md5 av funksjonskroppene (prosrc) slik de står i filen: tekst mellom dollar-merkene etter «as». */
export function functionBodies(text) {
  const re = /create\s+or\s+replace\s+function\s+(public\.\w+)\s*\(([\s\S]*?)\)\s*(?:returns|RETURNS)[\s\S]*?\b(?:as|AS)\s+(\$\w*\$)([\s\S]*?)\3/gi;
  const out = []; let m;
  while ((m = re.exec(text))) out.push({ name: m[1], md5: md5(m[4]), bytes: Buffer.byteLength(m[4], "utf8") });
  return out;
}

export function splitSql(text, file, maxBytes = 13000) {
  const body = bodyOf(text);
  if (body.includes(TAG)) throw new Error(`Filen inneholder ${TAG}; velg annet merke`);
  if (/[\r\t\u00a0]/.test(body)) throw new Error("Filen inneholder CR, tabulator eller hardt mellomrom; rens den først");
  const parts = chunk(body, maxBytes);
  const n = parts.length + 1;
  const name = (i) => `${file}.del${pad(i)}av${pad(n)}`;
  const files = [];
  parts.forEach((p, k) => {
    const i = k + 1;
    const head = `-- VENTER PÅ ROOT. ${name(i)}.PENDING.sql – del ${i} av ${n} av ${file}.PENDING.sql (${Buffer.byteLength(p, "utf8")} byte tekst).\n`
      + `-- Legger bare teksten i mellomlagringen og kontrollerer md5. Ingen virkning på appen før del ${n} («kjør»).\n`
      + `-- Kan kjøres på nytt (overskriver samme del). md5 for delen: ${md5(p)}\n`;
    const setup = i === 1
      ? `create table if not exists public._rm_sql_stage (file text not null, part int not null, body text not null,\n  created_at timestamptz not null default now(), primary key (file, part));\n`
        + `alter table public._rm_sql_stage enable row level security;\nrevoke all on public._rm_sql_stage from public, anon, authenticated;\n`
      : `do $g$ begin\n  if to_regclass('public._rm_sql_stage') is null then raise exception 'Kjør del 01 først'; end if;\n`
        + `  if not exists (select 1 from public._rm_sql_stage where file = '${file}' and part = ${i - 1}) then\n`
        + `    raise exception 'Kjør del ${pad(i - 1)} først';\n  end if;\nend $g$;\n`;
    const sql = head + "\n" + setup
      + `insert into public._rm_sql_stage (file, part, body) values ('${file}', ${i}, ${CLEAN_OPEN}${TAG}${p}${TAG}${CLEAN_CLOSE})\n  on conflict (file, part) do update set body = excluded.body, created_at = now();\n`
      + `do $g$ begin\n  if (select md5(body) from public._rm_sql_stage where file = '${file}' and part = ${i}) <> '${md5(p)}' then\n`
      + `    raise exception 'Del ${pad(i)} er ikke skrevet inn riktig (md5 avviker) – skriv den inn på nytt';\n  end if;\nend $g$;\n`;
    const check = `-- Kontroll for ${name(i)} (bare SELECT). Forventet: lengde ${p.length} tegn, md5 ${md5(p)}.\n`
      + `select part, length(body) as tegn, md5(body) as md5, md5(body) = '${md5(p)}' as riktig from public._rm_sql_stage where file = '${file}' and part = ${i};\n`;
    files.push({ name: `${name(i)}.PENDING.sql`, sql }, { name: `${name(i)}.check.sql`, sql: check });
  });
  const fnBodies = functionBodies(body);
  const expected = parts.map((p, k) => `    (${k + 1}, '${md5(p)}')`).join(",\n");
  const run = `-- VENTER PÅ ROOT. ${name(n)}.PENDING.sql – del ${n} av ${n} («kjør») av ${file}.PENDING.sql.\n`
    + `-- Kontrollerer at del 1–${n - 1} er skrevet inn riktig og at hele teksten har md5 ${md5(body)}\n`
    + `-- (= originalfilen uten egen begin/commit), kjører den i ÉN transaksjon og fjerner mellomlagringen.\n`
    + `-- Feiler noe, rulles alt tilbake og mellomlagringen står igjen, slik at feil del kan skrives inn på nytt.\n\nbegin;\n\n`
    + `do $g$\ndeclare v text; v_bad int;\nbegin\n  if to_regclass('public._rm_sql_stage') is null then raise exception 'Kjør del 01 først'; end if;\n`
    + `  select count(*) into v_bad from (values\n${expected}\n  ) e(part, m) left join public._rm_sql_stage s on s.file = '${file}' and s.part = e.part\n  where s.body is null or md5(s.body) <> e.m;\n`
    + `  if v_bad > 0 then raise exception '% del(er) mangler eller er feil skrevet inn – kjør .check for hver del', v_bad; end if;\n`
    + `  if (select count(*) from public._rm_sql_stage where file = '${file}') <> ${n - 1} then raise exception 'Uventet antall deler i mellomlagringen'; end if;\n`
    + `  select string_agg(body, '' order by part) into v from public._rm_sql_stage where file = '${file}';\n`
    + `  if md5(v) <> '${md5(body)}' then raise exception 'Hele teksten avviker fra den gjennomgåtte filen (md5)'; end if;\n`
    + `  execute v;\n  delete from public._rm_sql_stage where file = '${file}';\nend $g$;\n\n`
    + `do $g$ begin if not exists (select 1 from public._rm_sql_stage) then drop table public._rm_sql_stage; end if; end $g$;\n\ncommit;\n`;
  const runCheck = `-- Kontroll for ${name(n)} (bare SELECT). Viser md5 av funksjonskroppene slik de ligger i databasen,\n`
    + `-- mot verdiene i den gjennomgåtte filen. Alle «riktig» skal være true. Kjør også ${file}.check.sql.\n`
    + `select e.navn, md5(replace(p.prosrc, chr(13), '')) as md5_live, e.md5 as md5_fil, md5(replace(p.prosrc, chr(13), '')) = e.md5 as riktig\nfrom (values\n`
    + fnBodies.map((f) => `  ('${f.name}', '${f.md5}')`).join(",\n")
    + `\n) e(navn, md5)\nleft join pg_proc p on p.oid = (select max(x.oid) from pg_proc x join pg_namespace ns on ns.oid = x.pronamespace\n  where ns.nspname || '.' || x.proname = e.navn)\norder by e.navn;\n`
    + `-- Mellomlagringen er borte når alt er kjørt: select to_regclass('public._rm_sql_stage'); -- forventet null\n`;
  files.push({ name: `${name(n)}.PENDING.sql`, sql: run }, { name: `${name(n)}.check.sql`, sql: runCheck });
  return { files, parts, body, fnBodies };
}

if (process.argv[1] && basename(process.argv[1]) === "splitPendingSql.mjs") {
  const src = process.argv[2];
  const max = Number(process.argv[3] ?? 13000);
  const file = basename(src).replace(/\.PENDING\.sql$/, "");
  const outDir = join(dirname(src), file);
  mkdirSync(outDir, { recursive: true });
  const { files } = splitSql(readFileSync(src, "utf8"), file, max);
  for (const f of files) writeFileSync(join(outDir, f.name), f.sql);
  for (const f of files) console.log(`${f.name}\t${Buffer.byteLength(f.sql, "utf8")} byte`);
}
