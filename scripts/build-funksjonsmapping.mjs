// Bygger docs/ravarer-funksjonsmapping.json: én post per original funksjons-ID (R1–R203, F1–F110).
//
// Kilder:
//  - original funksjonstekst: docs/ravarer-funksjonsliste.md ved ORIGINAL_SHA (første versjon i git)
//  - dagens tekst/plassering: docs/ravarer-funksjonsliste.md i arbeidstreet
//  - eier/URL/barn per ID: docs/funksjonsmapping/review-owners.psv (reviewer-forslag, verifiseres her)
//  - tidligere avgrenset bevis: docs/funksjonsmapping/prior-evidence.psv (kopieres uendret, aldri oppgradert)
//
// Kartlegging er IKKE aksept. Skriptet kontrollerer bare at filer finnes, at barn faktisk importeres
// (direkte eller via eierens importkjede), og at URL-er treffer en rute og verdier rutens parser godtar.
//
// Bruk: node scripts/build-funksjonsmapping.mjs <inspisert-base-sha> [--check]
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const BASE = process.argv[2];
const CHECK = process.argv.includes("--check");
if (!BASE || !/^[0-9a-f]{40}$/.test(BASE)) { console.error("Oppgi full inspisert base-SHA (40 tegn)."); process.exit(2); }
const OUT = "docs/ravarer-funksjonsmapping.json";
const ORIGINAL_SHA = "61bfc14d";

const expand = (p) => p.replace(/^P\//, "src/ravarer/pages/").replace(/^C\//, "src/ravarer/components/").replace(/^X\//, "src/fakturaer/").replace(/^V\//, "src/varer/");
const read = (f) => readFileSync(f, "utf8");
const psv = (f) => read(f).split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("|"));

// ---------- funksjonslister ----------
function parseList(md) {
  const out = new Map(); let section = "";
  for (const line of md.split("\n")) {
    const h = line.match(/^## (.+)/); if (h) { section = h[1].trim(); continue; }
    const m = line.match(/^\| ([RF]\d+(?:, [RF]\d+)*) \| (.*)$/);
    if (!m || /^Fase 6/.test(section)) continue;
    const cells = m[2].split(/(?<!\\)\|/).map((c) => c.trim());
    for (const id of m[1].split(", ")) out.set(id, { section, feature: cells[0] ?? "", location: cells[1] ?? "", phase: cells[2] ?? "", status: cells[3] ?? "" });
  }
  return out;
}
const current = parseList(read("docs/ravarer-funksjonsliste.md"));
const original = parseList(execFileSync("git", ["show", `${ORIGINAL_SHA}:docs/ravarer-funksjonsliste.md`], { encoding: "utf8" }));

// ---------- importgraf ----------
const RESOLVE_EXT = ["", ".tsx", ".ts", "/index.tsx", "/index.ts"];
function resolveImport(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.join(path.dirname(from), spec);
  else return null;
  for (const e of RESOLVE_EXT) { const f = base + e; if (existsSync(f) && statSync(f).isFile()) return f; }
  return null;
}
const importCache = new Map();
function importsOf(f) {
  if (importCache.has(f)) return importCache.get(f);
  const src = existsSync(f) ? read(f) : "";
  const specs = [...src.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)].map((m) => m[1]);
  const r = specs.map((s) => resolveImport(f, s)).filter(Boolean);
  importCache.set(f, r); return r;
}
function reaches(from, target, depth = 4) {
  const seen = new Set([from]); let frontier = [from];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const f of frontier) for (const i of importsOf(f)) { if (i === target) return d + 1; if (!seen.has(i)) { seen.add(i); next.push(i); } }
    frontier = next;
  }
  return 0;
}

// ---------- ruter og parsere (lest fra kilden) ----------
const routeSrc = read("src/ravarer/routes.tsx") + read("src/App.tsx");
const ROUTES = [...routeSrc.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
const listOf = (file, re) => { const m = read(file).match(re); if (!m) throw new Error(`Fant ikke parser i ${file}`); return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]); };
const P = {
  liste: listOf("src/ravarer/lib/varerWorklist.ts", /LISTER = \[([^\]]+)\]/),
  rmSeksjon: listOf("src/ravarer/lib/rawMaterialSections.ts", /SECTIONS = \[([^\]]+)\]/),
  levSeksjon: listOf("src/ravarer/lib/supplierSections.ts", /SUPPLIER_SECTIONS = \[([^\]]+)\]/),
  lagerFane: listOf("src/ravarer/pages/hub/hubTabs.ts", /LAGER_TABS = \[([^\]]+)\]/),
  pkFane: listOf("src/ravarer/lib/paths.ts", /PriskontrollFane = ((?:"[^"]+"\s*\|?\s*)+)/),
  levFane: listOf("src/ravarer/lib/paths.ts", /LeverandorFane = ((?:"[^"]+"\s*\|?\s*)+)/),
  innSeksjon: listOf("src/ravarer/lib/paths.ts", /InnstillingSeksjon = ((?:"[^"]+"\s*\|?\s*)+)/),
  fakturaVisning: listOf("src/ravarer/pages/priskontroll/fakturaer/visning.ts", /FAKTURA_VISNINGER = \[([^\]]+)\]/),
  importer: ["ehf", "pdf", "manuelt"].filter((t) => read("src/ravarer/pages/priskontroll/import/ImportSheet.tsx").includes(t)),
  mengde: read("src/ravarer/pages/priskontroll/gjore/mengde/MengdeDiagnostikk.tsx").includes("visning=mengde") ? ["mengde"] : [],
};
const PARAMS = {
  "/ravarer/varer": { liste: P.liste, valgt: null },
  "/ravarer/varer/:id": { seksjon: P.rmSeksjon },
  "/ravarer/leverandorer": { fane: P.levFane },
  "/ravarer/leverandorer/:id": { seksjon: P.levSeksjon },
  "/ravarer/lager": { fane: P.lagerFane },
  "/ravarer/priskontroll": { fane: P.pkFane, importer: P.importer, visning: [...P.mengde, ...P.fakturaVisning] },
  "/ravarer/innstillinger": { seksjon: P.innSeksjon },
  "/ravarer/priskontroll/faktura/:id": { linje: null },
};
function checkUrl(u) {
  const [p, q] = u.split("?");
  if (!ROUTES.includes(p)) return `ukjent rute ${p}`;
  if (!q) return null;
  const allowed = PARAMS[p];
  if (!allowed) return `rute ${p} har ingen kjent parameterparser`;
  for (const kv of q.split("&")) {
    const [k, v] = kv.split("=");
    if (!(k in allowed)) return `parameter ${k} leses ikke av ${p}`;
    if (v.startsWith(":")) continue;
    if (allowed[k] && !allowed[k].includes(v)) return `${k}=${v} godtas ikke av parseren`;
  }
  return null;
}

// ---------- bevis ----------
const evidence = new Map();
for (const [ids, source, mock, browser, reports, next] of psv("docs/funksjonsmapping/prior-evidence.psv")) {
  for (const id of ids.split(",")) evidence.set(id, { source_review: source, mocked_test: mock, browser_check: browser, reports: reports.split(",").map((r) => `audit-2026-10-11/${r}`), outstanding_gate: next });
}

// ---------- handlingsspor (per ID, maskinverifisert) ----------
// docs/funksjonsmapping/action-trace.psv: ID|fil|ordrett bevis-substring|merknad, eller ID|GAP|grunn.
// Beviset må finnes ordrett i fila, og fila må nås fra eierfila (eller være den).
const traces = new Map();
if (existsSync("docs/funksjonsmapping/action-trace.psv")) {
  for (const [id, file, ev, note] of psv("docs/funksjonsmapping/action-trace.psv")) {
    if (!traces.has(id)) traces.set(id, []);
    traces.get(id).push(file === "GAP" ? { gap: ev } : { file, ev, note: note ?? "" });
  }
}

// ---------- poster ----------
const errors = [];
const owners = psv("docs/funksjonsmapping/review-owners.psv");
const recs = owners.map(([id, ownerRaw, urlsRaw, childRaw]) => {
  const owner = expand(ownerRaw);
  const child = childRaw && childRaw !== "-" ? expand(childRaw) : null;
  const urls = urlsRaw.split(",").map((s) => s.trim());
  const ownerOk = existsSync(owner) && statSync(owner).isFile();
  if (!ownerOk) errors.push(`${id}: eierfil finnes ikke (${owner})`);
  let childStatus = "ikke_oppgitt";
  if (child) {
    if (!existsSync(child)) { childStatus = "barn_finnes_ikke"; errors.push(`${id}: barn finnes ikke (${child})`); }
    else if (child === owner) childStatus = "samme_fil";
    else childStatus = reaches(owner, child) ? "importert_fra_eier" : "ikke_importert_fra_eier";
  }
  const urlErrors = urls.map(checkUrl).filter(Boolean);
  urlErrors.forEach((e) => errors.push(`${id}: ${e}`));
  const o = original.get(id); const c = current.get(id);
  if (!o) errors.push(`${id}: mangler i original funksjonsliste`);
  if (!c) errors.push(`${id}: mangler i dagens funksjonsliste`);
  const ev = evidence.get(id);
  const tr = traces.get(id) ?? [];
  const gap = tr.find((t) => t.gap)?.gap ?? null;
  const handler = [];
  for (const t of tr.filter((x) => !x.gap)) {
    if (!existsSync(t.file)) { errors.push(`${id}: sporfil finnes ikke (${t.file})`); continue; }
    if (!read(t.file).includes(t.ev)) { errors.push(`${id}: bevis «${t.ev}» finnes ikke i ${t.file}`); continue; }
    const reach = t.file === owner || reaches(owner, t.file, 8) > 0;
    handler.push({ file: t.file, evidence: t.ev, note: t.note, reached_from_owner: reach });
  }
  const traced = handler.length > 0 && handler.some((h) => h.reached_from_owner);
  return {
    id,
    section: c?.section ?? o?.section ?? "",
    original_feature: o?.feature ?? "",
    original_location: o?.location ?? "",
    current_feature: c?.feature ?? "",
    current_location_or_disposition: c?.location ?? "",
    route_owner_path: owner,
    action_component_paths: [...new Set([owner, ...(child ? [child] : []), ...handler.map((h) => h.file)])],
    handler_or_render_evidence: handler,
    preservation_gap: gap,
    canonical_url_templates: urls,
    mapping_status: !ownerOk || urlErrors.length ? "feil" : gap ? "bevaringsgap" : traced ? "handling_sporet_i_kilde" : childStatus === "importert_fra_eier" ? "eier_og_barn_verifisert_ved_import" : childStatus === "ikke_importert_fra_eier" ? "barn_ikke_sporet" : "eier_verifisert_handling_ikke_sporet",
    child_import_check: childStatus,
    source_review: ev?.source_review ?? "ukjent",
    mocked_test: ev?.mocked_test ?? "ukjent",
    browser_check: ev?.browser_check ?? "ukjent",
    evidence_reports: ev?.reports ?? [],
    outstanding_gate: ev?.outstanding_gate ?? "ikke_vurdert",
    // Historisk, datert delbevis holdes adskilt fra dagens kildesporing (mapping_status/handler_or_render_evidence).
    // Det kopieres uendret og oppgraderes aldri til aksept.
    historical_evidence: {
      prior_evidence_ledger: ev ? { dated: "2026-10-11", source: "docs/funksjonsmapping/prior-evidence.psv", source_review: ev.source_review, mocked_test: ev.mocked_test, browser_check: ev.browser_check, reports: ev.reports, outstanding_gate: ev.outstanding_gate } : null,
      list_status_note: c?.status || o?.status || null,
      list_status_is_partial: /kilde|komponenttest|ikke nettleser|ikke innlogget/i.test(c?.status ?? ""),
    },
    acceptance: "ikke akseptert",
  };
}).sort((a, b) => a.id[0].localeCompare(b.id[0]) || Number(a.id.slice(1)) - Number(b.id.slice(1)));

// Nøyaktig ID-sett: R1–R203 og F1–F110, ingen duplikater.
const expected = [...Array.from({ length: 203 }, (_, i) => `R${i + 1}`), ...Array.from({ length: 110 }, (_, i) => `F${i + 1}`)];
const got = recs.map((r) => r.id);
const dup = got.filter((x, i) => got.indexOf(x) !== i);
const missing = expected.filter((x) => !got.includes(x));
const extra = got.filter((x) => !expected.includes(x));
if (dup.length || missing.length || extra.length) errors.push(`ID-sett: duplikat ${dup} mangler ${missing} ekstra ${extra}`);
// Original tekst skal være bevart i dagens liste for alle ID-er der funksjonen ikke er eksplisitt omdefinert.
for (const id of ["R192", "R195"]) if (original.get(id)?.feature !== current.get(id)?.feature) errors.push(`${id}: original funksjonstekst er ikke bevart`);

const doc = {
  provenance: {
    inspected_base_sha: BASE,
    original_feature_text_sha: ORIGINAL_SHA,
    generated_by: "scripts/build-funksjonsmapping.mjs",
    inputs: ["docs/ravarer-funksjonsliste.md", "docs/funksjonsmapping/review-owners.psv", "docs/funksjonsmapping/prior-evidence.psv", "docs/funksjonsmapping/action-trace.psv"],
    note: "Artefaktets egen commit finnes via git-historikk; den skrives ikke inn her. Kartlegging er ikke aksept.",
  },
  records: recs,
};
const json = JSON.stringify(doc, null, 1) + "\n";
const summary = recs.reduce((m, r) => ((m[r.mapping_status] = (m[r.mapping_status] ?? 0) + 1), m), {});
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
if (CHECK) {
  const prev = existsSync(OUT) ? read(OUT) : "";
  if (prev !== json) { console.error("Kartfilen er ikke oppdatert. Kjør skriptet på nytt."); process.exit(1); }
} else writeFileSync(OUT, json);
console.log(recs.length, JSON.stringify(summary));
