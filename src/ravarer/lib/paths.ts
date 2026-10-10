/**
 * Stibygger for ALLE Råvarer-sider (Råvarer 2.0). Bruk disse i stedet for
 * hardkodede "/ravarer/..."-strenger; omdirigeringene i `legacyRoutes.ts`
 * trengs da bare for bokmerker og gamle e-postlenker.
 */
type Q = Record<string, string | number | boolean | null | undefined>;

export function withQuery(base: string, q?: Q): string {
  if (!q) return base;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === null || v === undefined || v === "" || v === false) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

const enc = encodeURIComponent;
export const RAVARER_ROOT = "/ravarer";

export type PriskontrollFane = "gjore" | "fakturaer" | "godkjenning" | "saker";
export type LeverandorFane = "leverandorer" | "avtaler" | "forhandlinger";
export type LagerFane = "beholdning" | "varemottak" | "telling";
export type InnstillingSeksjon = "priskontroll" | "tripletex" | "kategorier" | "ai";

export const paths = {
  oversikt: () => RAVARER_ROOT,

  // Varer
  varer: (q?: Q) => withQuery(`${RAVARER_ROOT}/varer`, q),
  raavare: (id: string, opts?: { tab?: string } & Q) => withQuery(`${RAVARER_ROOT}/varer/${enc(id)}`, opts),
  pakninger: (q?: Q) => withQuery(`${RAVARER_ROOT}/varer/pakninger`, q),
  deklarasjonsnavn: (q?: Q) => withQuery(`${RAVARER_ROOT}/varer/deklarasjonsnavn`, q),
  naering: (q?: Q) => withQuery(`${RAVARER_ROOT}/varer/naering`, q),
  databladEndringer: (q?: Q) => withQuery(`${RAVARER_ROOT}/varer/datablad-endringer`, q),
  matvaretabellen: (q?: Q) => withQuery(`${RAVARER_ROOT}/varer/matvaretabellen`, q),
  databladOpplasting: () => `${RAVARER_ROOT}/varer/datablad-opplasting`,

  // Priskontroll
  priskontroll: (q?: { fane?: PriskontrollFane } & Q) => withQuery(`${RAVARER_ROOT}/priskontroll`, q),
  fakturaInnboks: (q?: { innboks?: "klar" | "fullfort"; faktura?: string } & Q) =>
    withQuery(`${RAVARER_ROOT}/priskontroll`, { fane: "fakturaer", visning: "innboks", ...q }),
  alleFakturaer: (q?: Q) => withQuery(`${RAVARER_ROOT}/priskontroll`, { fane: "fakturaer", visning: "alle", ...q }),
  varekoblinger: (q?: { leverandor?: string; status?: string; q?: string } & Q) =>
    withQuery(`${RAVARER_ROOT}/priskontroll`, { fane: "gjore", ...q }),
  godkjenning: () => withQuery(`${RAVARER_ROOT}/priskontroll`, { fane: "godkjenning" }),
  saker: () => withQuery(`${RAVARER_ROOT}/priskontroll`, { fane: "saker" }),
  faktura: (id: string, q?: Q) => withQuery(`${RAVARER_ROOT}/priskontroll/faktura/${enc(id)}`, q),
  registrerLinjer: (id: string) => `${RAVARER_ROOT}/priskontroll/faktura/${enc(id)}/registrer-linjer`,
  sak: (id: string) => `${RAVARER_ROOT}/priskontroll/saker/${enc(id)}`,
  importFaktura: (q?: { tab?: "ehf" | "pdf" | "manuelt" } & Q) => withQuery(`${RAVARER_ROOT}/priskontroll/import`, q),
  beslutninger: (q?: { omfang?: "ravarer" } & Q) => withQuery(`${RAVARER_ROOT}/priskontroll/beslutninger`, q),
  beslutning: (key: string, q?: Q) => withQuery(`${RAVARER_ROOT}/priskontroll/beslutninger/${enc(key)}`, q),
  reberegn: () => `${RAVARER_ROOT}/priskontroll/verktoy/reberegn`,

  // Leverandører
  leverandorer: (q?: { fane?: LeverandorFane } & Q) => withQuery(`${RAVARER_ROOT}/leverandorer`, q),
  leverandor: (id: string, q?: Q) => withQuery(`${RAVARER_ROOT}/leverandorer/${enc(id)}`, q),
  avtaler: () => withQuery(`${RAVARER_ROOT}/leverandorer`, { fane: "avtaler" }),
  forhandlinger: () => withQuery(`${RAVARER_ROOT}/leverandorer`, { fane: "forhandlinger" }),
  forhandling: (id: string) => `${RAVARER_ROOT}/leverandorer/forhandlinger/${enc(id)}`,
  forhandlingRediger: (id: string) => `${RAVARER_ROOT}/leverandorer/forhandlinger/${enc(id)}/rediger`,
  nyForhandling: (q?: Q) => withQuery(`${RAVARER_ROOT}/leverandorer/forhandlinger/ny`, q),
  nyLiveForhandling: () => `${RAVARER_ROOT}/leverandorer/forhandlinger/live/ny`,
  liveForhandling: (id: string) => `${RAVARER_ROOT}/leverandorer/forhandlinger/live/${enc(id)}`,

  // Lager
  lager: (q?: { fane?: LagerFane } & Q) => withQuery(`${RAVARER_ROOT}/lager`, q),

  // Innstillinger
  innstillinger: (q?: { seksjon?: InnstillingSeksjon } & Q) => withQuery(`${RAVARER_ROOT}/innstillinger`, q),
} as const;
