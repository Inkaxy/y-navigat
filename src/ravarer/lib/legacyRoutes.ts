/**
 * Omdirigering fra gamle Råvarer-stier (før Råvarer 2.0) til nye. Ren funksjon:
 * tar sti og query, gir ny URL eller null når stien ikke er en gammel sti.
 * Query-parametre videreføres alltid, med de omdøpingene som står i tabellen.
 */
import { normalizePriskontrollSearch } from "@/ravarer/pages/priskontroll/fakturaer/visning";

const R = "/ravarer";

function merge(search: string, extra: [string, string][], rename: Record<string, string | null> = {}, values: Record<string, Record<string, string>> = {}): string {
  const src = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out = new URLSearchParams();
  for (const [k, v] of extra) out.set(k, v);
  src.forEach((v, k) => {
    if (k in rename) {
      const to = rename[k];
      const mapped = values[k] ? values[k][v] : v;
      if (to && mapped && !out.has(to)) out.set(to, mapped);
      return;
    }
    if (!out.has(k)) out.set(k, v);
  });
  const s = out.toString();
  return s ? `?${s}` : "";
}

type Entry = { to: string; extra?: [string, string][]; rename?: Record<string, string | null>; /** Verdioversetting for omdøpte parametre (ukjente verdier droppes). */ values?: Record<string, Record<string, string>>; /** Import-sidepanel: standardfane når ingen er oppgitt. */ importer?: boolean };
const IMP = { to: `${R}/priskontroll`, rename: { tab: "importer" }, importer: true } as const;

/** Gamle beslutningstyper → gruppe i Å gjøre. */
export const LEGACY_TYPE_TO_GRUPPE: Record<string, string> = { material: "kobling", package: "pakning", price: "pris" };

/** Gammel beslutningsvisning → Å gjøre; søk, leverandør og type (som gruppe) følger med. */
const GJORE: Entry = {
  to: `${R}/priskontroll`, extra: [["fane", "gjore"]],
  rename: { omfang: "gruppe", type: "gruppe", fra: null, side: null, fane: null },
  values: { omfang: LEGACY_TYPE_TO_GRUPPE, type: LEGACY_TYPE_TO_GRUPPE },
};

const STATIC: Record<string, Entry> = {
  "/ravarer/vareliste": { to: `${R}/varer` },
  "/ravarer/pakninger": { to: `${R}/varer/pakninger`, extra: [["filter", "ubekreftet"]] },
  "/ravarer/pakningsstorrelser": { to: `${R}/varer/pakninger` },
  "/ravarer/deklarasjonsnavn": { to: `${R}/varer/deklarasjonsnavn` },
  "/ravarer/koble-matvaretabellen": { to: `${R}/varer/naering` },
  "/ravarer/datablad-endringer": { to: `${R}/varer/datablad-endringer` },
  "/ravarer/matvaretabellen": { to: `${R}/varer/matvaretabellen` },
  "/ravarer/datablad-bulk": { to: `${R}/varer/datablad-opplasting` },
  "/ravarer/fakturaer": { to: `${R}/priskontroll`, extra: [["fane", "fakturaer"], ["visning", "alle"]] },
  "/ravarer/fakturaer/til-behandling": {
    to: `${R}/priskontroll`, extra: [["fane", "fakturaer"], ["visning", "innboks"]], rename: { fane: "innboks" },
  },
  "/ravarer/fakturaer/i-dag": { to: `${R}/priskontroll`, extra: [["fane", "gjore"]] },
  "/ravarer/fakturaer/beslutninger": GJORE,
  "/ravarer/fakturaer/ravarer": GJORE,
  // Beslutninger per gruppe er dekket av Å gjøre (fase 3c).
  "/ravarer/priskontroll/beslutninger": GJORE,
  "/ravarer/fakturaer/varekoblinger": { to: `${R}/priskontroll/varekort` },
  "/ravarer/fakturaer/vareminne": { to: `${R}/priskontroll/varekort` },
  "/ravarer/fakturaer/oversikt": { to: `${R}/priskontroll`, extra: [["fane", "godkjenning"]], rename: { fane: "status" } },
  "/ravarer/fakturaer/saker": { to: `${R}/priskontroll`, extra: [["fane", "saker"]] },
  "/ravarer/priskontroll/import": IMP,
  "/ravarer/fakturaer/import": IMP,
  "/ravarer/fakturaer/ny": { ...IMP, extra: [["importer", "manuelt"]] },
  "/ravarer/fakturaer/import-ehf": { ...IMP, extra: [["importer", "ehf"]] },
  "/ravarer/fakturaer/import-pdf": { ...IMP, extra: [["importer", "pdf"]] },
  "/ravarer/fakturaer/reberegn-kostpriser": { to: `${R}/priskontroll/verktoy/reberegn` },
  "/ravarer/avtaler": { to: `${R}/leverandorer`, extra: [["fane", "avtaler"]] },
  "/ravarer/forhandlinger": { to: `${R}/leverandorer`, extra: [["fane", "forhandlinger"]] },
  "/ravarer/varemottak": { to: `${R}/lager`, extra: [["fane", "varemottak"]] },
  "/ravarer/varetelling": { to: `${R}/lager`, extra: [["fane", "telling"]] },
  "/ravarer/innstillinger/match-toleranser": { to: `${R}/innstillinger`, extra: [["seksjon", "priskontroll"]] },
  "/ravarer/innstillinger/tripletex": { to: `${R}/innstillinger`, extra: [["seksjon", "tripletex"]] },
  "/ravarer/innstillinger/kategorier": { to: `${R}/innstillinger`, extra: [["seksjon", "kategorier"]] },
  "/ravarer/innstillinger/ai-tjenester": { to: `${R}/innstillinger`, extra: [["seksjon", "ai"]] },
  // Eldre aliaser utenfor /ravarer
  "/fakturaer": { to: `${R}/priskontroll`, extra: [["fane", "fakturaer"], ["visning", "alle"]] },
  "/fakturaer/til-behandling": { to: `${R}/priskontroll`, extra: [["fane", "fakturaer"], ["visning", "innboks"]], rename: { fane: "innboks" } },
  "/fakturaer/ny": { ...IMP, extra: [["importer", "manuelt"]] },
  "/fakturaer/import-ehf": { ...IMP, extra: [["importer", "ehf"]] },
  "/fakturaer/import-pdf": { ...IMP, extra: [["importer", "pdf"]] },
};

const DYNAMIC: { re: RegExp; to: (m: RegExpMatchArray) => string; dropQuery?: boolean; legacyKey?: boolean }[] = [
  { re: /^\/ravarer\/vareliste\/([^/]+)$/, to: (m) => `${R}/varer/${m[1]}` },
  { re: /^\/ravarer\/fakturaer\/i-dag\/([^/]+)$/, to: () => "", legacyKey: true },
  { re: /^\/ravarer\/priskontroll\/beslutninger\/([^/]+)$/, to: () => "", legacyKey: true },
  { re: /^\/ravarer\/fakturaer\/saker\/([^/]+)$/, to: (m) => `${R}/priskontroll/saker/${m[1]}` },
  { re: /^\/ravarer\/fakturaer\/([^/]+)\/registrer-linjer$/, to: (m) => `${R}/priskontroll/faktura/${m[1]}/registrer-linjer` },
  { re: /^\/ravarer\/fakturaer\/([^/]+)$/, to: (m) => `${R}/priskontroll/faktura/${m[1]}` },
  { re: /^\/fakturaer\/([^/]+)$/, to: (m) => `${R}/priskontroll/faktura/${m[1]}` },
  { re: /^\/ravarer\/forhandlinger\/(.+)$/, to: (m) => `${R}/leverandorer/forhandlinger/${m[1]}` },
];

/** Gamle stier som ruteren må registrere for å sende videre. */
export const LEGACY_RAVARER_PATHS: string[] = [
  ...Object.keys(STATIC),
  "/ravarer/vareliste/:id",
  "/ravarer/fakturaer/i-dag/:key",
  "/ravarer/priskontroll/beslutninger/:key",
  "/ravarer/fakturaer/saker/:id",
  "/ravarer/fakturaer/:id/registrer-linjer",
  "/ravarer/fakturaer/:id",
  "/fakturaer/:id",
  "/ravarer/forhandlinger/*",
];

const KIND_TO_GRUPPE: Record<string, string> = { m: "kobling", p: "pakning", f: "pris", pr: "pris" };

/**
 * Gammel beslutningsnøkkel (`{type}:{selskap}:{valuta}:{debet|kredit}:{leverandør}:{varenr}:…`
 * eller `line:{id}`) → Å gjøre med leverandør, søk på varenummer og gruppe. Query fra den gamle
 * lenken (søk, leverandør, type) følger med; verdier fra nøkkelen vinner bare når de mangler.
 */
export type LegacyDecisionTarget = { kind: "line"; lineId: string } | { kind: "key"; supplierId: string; sku: string } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hva den gamle nøkkelen peker på — løses til kanonisk varekort av LegacyRavarerRedirect (innlogget). */
export function legacyDecisionTarget(rawKey: string): LegacyDecisionTarget {
  let key = rawKey;
  try { key = decodeURIComponent(rawKey); } catch (e) { if (!(e instanceof URIError)) throw e; }
  const parts = key.split(":");
  if (parts[0] === "line") return parts[1] && UUID.test(parts[1]) ? { kind: "line", lineId: parts[1] } : null;
  if (parts.length >= 6 && KIND_TO_GRUPPE[parts[0]] && UUID.test(parts[4] ?? "") && parts[5]) return { kind: "key", supplierId: parts[4], sku: parts[5] };
  return null;
}

/** Gammel beslutnings-sti (i-dag/:key eller beslutninger/:key)? Gir rå nøkkel. */
export function legacyDecisionKeyFromPath(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, "");
  const m = p.match(/^\/ravarer\/fakturaer\/i-dag\/([^/]+)$/) ?? p.match(/^\/ravarer\/priskontroll\/beslutninger\/([^/]+)$/);
  return m ? m[1] : null;
}

/** Å gjøre-URL med valgt varekort; query fra den gamle lenken bevares. */
export function withSelected(url: string, valgt: string | null): string {
  if (!valgt) return url;
  const [path, q = ""] = url.split("?");
  const sp = new URLSearchParams(q);
  sp.set("valgt", valgt);
  return `${path}?${sp.toString()}`;
}

export function legacyDecisionUrl(rawKey: string, search: string): string {
  let key = rawKey;
  try { key = decodeURIComponent(rawKey); } catch (e) { if (!(e instanceof URIError)) throw e; }
  const parts = key.split(":");
  const extra: [string, string][] = [["fane", "gjore"]];
  const src = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (parts[0] !== "line" && parts.length >= 6 && KIND_TO_GRUPPE[parts[0]]) {
    if (!src.has("type") && !src.has("omfang")) extra.push(["gruppe", KIND_TO_GRUPPE[parts[0]]]);
    if (parts[4] && !src.has("leverandor")) extra.push(["leverandor", parts[4]]);
    if (parts[5] && !src.has("q")) extra.push(["q", parts[5]]);
  }
  return `${R}/priskontroll${merge(search, extra, GJORE.rename, GJORE.values)}`;
}

export function resolveLegacyRavarerUrl(pathname: string, search: string): string | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const st = STATIC[p];
  if (st) {
    let q = merge(search, st.extra ?? [], st.rename, st.values);
    if (st.importer && !new URLSearchParams(q.slice(1)).has("importer")) q = q ? `${q}&importer=ehf` : "?importer=ehf";
    return (st.to === `${R}/priskontroll` && normalizePriskontrollSearch(q)) || st.to + q;
  }
  for (const d of DYNAMIC) {
    const m = p.match(d.re);
    if (m && d.legacyKey) return legacyDecisionUrl(m[1], search);
    if (m) return d.dropQuery ? d.to(m) : d.to(m) + merge(search, []);
  }
  return null;
}
