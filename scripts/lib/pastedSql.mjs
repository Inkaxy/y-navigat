// Simulerer innliming i Supabase SQL Editor. Med SQL_EOL=crlf får filene som limes inn (1-kjor-na, 2-endrer-data,
// kontroll) Windows-linjeskift (CR+LF), slik Henriks utklippstavle ga 18.11. Andre filer (kjort/, fixtures) leses uendret.
// fingerprint() gir et sammenlignbart avtrykk av databasen: alle funksjonsdefinisjoner og policyer i public, og antall
// funksjoner/rader som inneholder CR (skal være 0). Brukes av scripts/test-innliming-crlf.mjs.
import { readFileSync } from "node:fs";

export const EOL = process.env.SQL_EOL === "crlf" ? "crlf" : "lf";
const PASTED = /[\\/]supabase[\\/]pending[\\/](1-kjor-na|2-endrer-data|kontroll)[\\/]/;

export function asPasted(text, path) {
  if (EOL !== "crlf" || !PASTED.test(path)) return text;
  return text.replace(/\r?\n/g, "\r\n");
}

export function readSql(path) {
  return asPasted(readFileSync(path, "utf8"), path);
}

export async function fingerprint(db) {
  const f = (await db.query(`select
    (select md5(coalesce(string_agg(pg_get_functiondef(p.oid), E'\\n' order by p.proname, pg_get_function_identity_arguments(p.oid)), ''))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f') as funksjoner,
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and strpos(p.prosrc, chr(13)) > 0) as cr_i_funksjoner,
    (select md5(coalesce(string_agg(tablename || '.' || policyname || ':' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
       E'\\n' order by tablename, policyname), '')) from pg_policies) as policyer`)).rows[0];
  const tables = (await db.query(`select table_name t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).rows;
  let crRader = 0;
  for (const { t } of tables) {
    crRader += Number((await db.query(`select count(*)::int n from public."${t}" x where strpos(x::text, chr(13)) > 0`)).rows[0].n);
  }
  return { ...f, cr_rader: crRader, tabeller: tables.length };
}

export async function printFingerprint(db) {
  let f;
  try {
    f = await fingerprint(db);
  } catch (e) {
    // Siste kontroll i noen tester er en vakt som avbryter transaksjonen; avslutt den før avtrykket leses.
    if (!/transaction is aborted/.test(String(e?.message))) throw e;
    await db.exec("rollback");
    f = await fingerprint(db);
  }
  console.log(`FINGERAVTRYKK ${JSON.stringify(f)}`);
}
