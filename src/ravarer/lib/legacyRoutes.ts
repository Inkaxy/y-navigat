/**
 * Omdirigering fra gamle Råvarer-stier (før Råvarer 2.0) til nye. Ren funksjon:
 * tar sti og query, gir ny URL eller null når stien ikke er en gammel sti.
 * Query-parametre videreføres alltid, med de omdøpingene som står i tabellen.
 */
const R = "/ravarer";

function merge(search: string, extra: [string, string][], rename: Record<string, string | null> = {}): string {
  const src = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out = new URLSearchParams();
  for (const [k, v] of extra) out.set(k, v);
  src.forEach((v, k) => {
    if (k in rename) {
      const to = rename[k];
      if (to && !out.has(to)) out.set(to, v);
      return;
    }
    if (!out.has(k)) out.set(k, v);
  });
  const s = out.toString();
  return s ? `?${s}` : "";
}

const STATIC: Record<string, { to: string; extra?: [string, string][]; rename?: Record<string, string | null> }> = {
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
  "/ravarer/fakturaer/beslutninger": { to: `${R}/priskontroll/beslutninger` },
  "/ravarer/fakturaer/ravarer": { to: `${R}/priskontroll/beslutninger`, extra: [["omfang", "ravarer"]] },
  "/ravarer/fakturaer/varekoblinger": { to: `${R}/priskontroll`, extra: [["fane", "gjore"]] },
  "/ravarer/fakturaer/vareminne": { to: `${R}/priskontroll`, extra: [["fane", "gjore"]] },
  "/ravarer/fakturaer/oversikt": { to: `${R}/priskontroll`, extra: [["fane", "godkjenning"]], rename: { fane: "status" } },
  "/ravarer/fakturaer/saker": { to: `${R}/priskontroll`, extra: [["fane", "saker"]] },
  "/ravarer/fakturaer/import": { to: `${R}/priskontroll/import` },
  "/ravarer/fakturaer/ny": { to: `${R}/priskontroll/import`, extra: [["tab", "manuelt"]] },
  "/ravarer/fakturaer/import-ehf": { to: `${R}/priskontroll/import`, extra: [["tab", "ehf"]] },
  "/ravarer/fakturaer/import-pdf": { to: `${R}/priskontroll/import`, extra: [["tab", "pdf"]] },
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
  "/fakturaer/ny": { to: `${R}/priskontroll/import`, extra: [["tab", "manuelt"]] },
  "/fakturaer/import-ehf": { to: `${R}/priskontroll/import`, extra: [["tab", "ehf"]] },
  "/fakturaer/import-pdf": { to: `${R}/priskontroll/import`, extra: [["tab", "pdf"]] },
};

const DYNAMIC: { re: RegExp; to: (m: RegExpMatchArray) => string }[] = [
  { re: /^\/ravarer\/vareliste\/([^/]+)$/, to: (m) => `${R}/varer/${m[1]}` },
  { re: /^\/ravarer\/fakturaer\/i-dag\/([^/]+)$/, to: (m) => `${R}/priskontroll/beslutninger/${m[1]}` },
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
  "/ravarer/fakturaer/saker/:id",
  "/ravarer/fakturaer/:id/registrer-linjer",
  "/ravarer/fakturaer/:id",
  "/fakturaer/:id",
  "/ravarer/forhandlinger/*",
];

export function resolveLegacyRavarerUrl(pathname: string, search: string): string | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const st = STATIC[p];
  if (st) return st.to + merge(search, st.extra ?? [], st.rename);
  for (const d of DYNAMIC) {
    const m = p.match(d.re);
    if (m) return d.to(m) + merge(search, []);
  }
  return null;
}
