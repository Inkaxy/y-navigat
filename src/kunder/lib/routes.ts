// Sentral path-konstant for Kunder-appen i NBhub.
// Bruk disse i stedet for hardkodede strenger slik at app-prefikset
// kan endres ett sted hvis nødvendig.

export const KUNDER_BASE = "/kunder";

export const kunderRoutes = {
  root: KUNDER_BASE,
  kundeliste: `${KUNDER_BASE}/kundeliste`,
  kundeDetalj: (id: string) => `${KUNDER_BASE}/kundeliste/${id}`,
  profiler: `${KUNDER_BASE}/profiler`,
  profilDetalj: (id: string) => `${KUNDER_BASE}/profiler/${id}`,
  kundegrupper: `${KUNDER_BASE}/kundegrupper`,
  historikk: `${KUNDER_BASE}/historikk`,
  innstillinger: `${KUNDER_BASE}/innstillinger`,
  hentesteder: `${KUNDER_BASE}/innstillinger/hentesteder`,
} as const;
