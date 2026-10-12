// Kjører varetelling-SQL-forslaget mot innebygd PostgreSQL (PGlite) i minnet. Rører aldri live.
// Bruk: node scripts/test-varetelling-sql.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "pending");
const pending = readFileSync(join(dir, "20261012_varetelling_foundation.PENDING.sql"), "utf8");
const test = readFileSync(join(dir, "20261012_varetelling_foundation.test.sql"), "utf8")
  .replace(/^\\set .*$/m, "")
  .replace(/^\\i 20261012_varetelling_foundation\.PENDING\.sql$/m, () => pending);

const stage3 = readFileSync(join(dir, "20261012_varetelling_stage3.PENDING.sql"), "utf8");
const stage3Test = readFileSync(join(dir, "20261012_varetelling_stage3.test.sql"), "utf8")
  .replace(/^\\i 20261012_varetelling_stage3\.PENDING\.sql$/m, () => stage3);
const all = test + "\n" + stage3Test;
const db = new PGlite();
let oks = 0;
const onNotice = (n) => { if (String(n.message).startsWith("OK")) oks++; if (String(n.message).startsWith("DBG")) console.log(n.message); };
try {
  const res = await db.exec(all, { onNotice });
  const last = res.at(-1)?.rows?.[0];
  console.log(`OK-kontroller: ${oks}`);
  console.log(last?.resultat ?? "ukjent resultat");
  process.exit(last?.resultat === "ALLE VARETELLING-SQL-TESTER BESTÅTT" ? 0 : 1);
} catch (e) {
  console.error(`OK før feil: ${oks}`);
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
