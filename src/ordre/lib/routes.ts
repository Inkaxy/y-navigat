// Sentral path-konstant for Ordre-appen i NBhub.
// Bruk disse i stedet for hardkodede strenger så app-prefikset
// kan endres ett sted hvis nødvendig.

export const ORDRE_BASE = "/ordre";

export const ordreRoutes = {
  root: ORDRE_BASE,
  dashbord: `${ORDRE_BASE}/dashbord`,

  // Ordrer
  ordrer: `${ORDRE_BASE}/ordrer`,
  nyOrdre: `${ORDRE_BASE}/ordrer/ny`,
  ordreDetalj: (id: string) => `${ORDRE_BASE}/ordrer/${id}`,

  // Pakksedler
  pakksedler: `${ORDRE_BASE}/pakksedler`,
  pakksedlerListe: `${ORDRE_BASE}/pakksedler/liste`,
  pakksedlerKorrigeringer: `${ORDRE_BASE}/pakksedler/korrigeringer`,
  pakksedlerInnstillinger: `${ORDRE_BASE}/pakksedler/innstillinger`,
  pakkseddelDetalj: (id: string) => `${ORDRE_BASE}/pakksedler/${id}`,

  // Kakebilder
  kakebilder: `${ORDRE_BASE}/kakebilder`,
  kakebilderListe: `${ORDRE_BASE}/kakebilder/liste`,
  kakebilderEditor: (id: string) => `${ORDRE_BASE}/kakebilder/editor/${id}`,
  kakebilderPrint: `${ORDRE_BASE}/kakebilder/print`,

  // Øvrige toppnivå
  turer: `${ORDRE_BASE}/turer`,
  leveringsregler: `${ORDRE_BASE}/leveringsregler`,
  fasteRutiner: `${ORDRE_BASE}/faste-rutiner`,
  leveringskalender: `${ORDRE_BASE}/leveringskalender`,
  ticket: `${ORDRE_BASE}/ticket`,
  aiForslag: `${ORDRE_BASE}/ai-forslag`,
  avvik: `${ORDRE_BASE}/avvik`,

  // Hjelpe-sider
  kundeordrer: `${ORDRE_BASE}/kundeordrer`,
} as const;
