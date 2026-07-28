/** Map fra pathname til sidens visningsnavn for AppTabs-knappen.
 *  Mest spesifikke matcher først. */

interface PageRule {
  test: (path: string) => boolean;
  label: string;
}

const RULES: PageRule[] = [
  // Topp-nivå
  { test: (p) => p === "/" || p === "/hjem", label: "Hjem" },
  { test: (p) => p === "/min-profil", label: "Min profil" },
  { test: (p) => p === "/varsler", label: "Varsler" },
  { test: (p) => p === "/hjelp", label: "Hjelp" },

  // Admin
  { test: (p) => p === "/admin", label: "Admin" },
  { test: (p) => p.startsWith("/admin/selskaper"), label: "Selskaper" },
  { test: (p) => p.startsWith("/admin/brukere"), label: "Brukere" },
  { test: (p) => p.startsWith("/admin/tilganger"), label: "Tilganger" },
  { test: (p) => p.startsWith("/admin/outlets"), label: "Utsalg" },
  { test: (p) => p.startsWith("/admin/stillinger"), label: "Stillinger" },
  { test: (p) => p.startsWith("/admin/apper"), label: "Apper" },
  { test: (p) => p.startsWith("/admin/integrasjoner"), label: "Integrasjoner" },
  { test: (p) => p.startsWith("/admin/helsesenter"), label: "Helsesenter" },
  { test: (p) => p.startsWith("/admin/audit"), label: "Audit" },

  // Varer
  { test: (p) => p.startsWith("/varer/vareliste"), label: "Vareliste" },
  { test: (p) => p.startsWith("/varer/priser"), label: "Priser" },
  { test: (p) => p.startsWith("/varer/spesialpriser"), label: "Spesialpriser" },
  { test: (p) => p === "/varer/oppskrifter/krever-opprydding", label: "Krever opprydding" },
  { test: (p) => p.startsWith("/varer/oppskrifter"), label: "Oppskrifter" },
  { test: (p) => p.startsWith("/varer/kakebygger"), label: "Kakebygger" },
  { test: (p) => p.startsWith("/varer/sortiment"), label: "Sortiment" },
  { test: (p) => p.startsWith("/varer/avvik"), label: "Avvik" },
  { test: (p) => p.startsWith("/varer/innstillinger/hovedvaregrupper"), label: "Hovedvaregrupper" },
  { test: (p) => p.startsWith("/varer/innstillinger/undervaregrupper"), label: "Undervaregrupper" },
  { test: (p) => p.startsWith("/varer/innstillinger/varesider"), label: "Varesider" },
  { test: (p) => p.startsWith("/varer/innstillinger/salgsgrupper"), label: "Salgsgrupper" },
  { test: (p) => p.startsWith("/varer/innstillinger/produksjonsgrupper"), label: "Produksjonsgrupper" },
  { test: (p) => p.startsWith("/varer/innstillinger"), label: "Innstillinger" },
  { test: (p) => p === "/varer", label: "Varer" },

  // Kunder
  { test: (p) => p.startsWith("/kunder/kundeliste"), label: "Kundeliste" },
  { test: (p) => p.startsWith("/kunder/profiler"), label: "Profiler" },
  { test: (p) => p.startsWith("/kunder/kundegrupper"), label: "Kundegrupper" },
  { test: (p) => p.startsWith("/kunder/historikk"), label: "Historikk" },
  { test: (p) => p.startsWith("/kunder/portaltilgang"), label: "Portaltilgang" },
  { test: (p) => p.startsWith("/kunder/innstillinger/hentesteder"), label: "Hentesteder" },
  { test: (p) => p.startsWith("/kunder/innstillinger"), label: "Innstillinger" },
  { test: (p) => p === "/kunder", label: "Kunder" },

  // Råvarer
  { test: (p) => p.startsWith("/ravarer/vareliste"), label: "Vareliste" },
  { test: (p) => p.startsWith("/ravarer/leverandorer"), label: "Leverandører" },
  { test: (p) => p.startsWith("/ravarer/avtaler"), label: "Avtaler" },
  { test: (p) => p.startsWith("/ravarer/datablad-endringer"), label: "Datablad-endringer" },
  { test: (p) => p.startsWith("/ravarer/datablad-bulk"), label: "Bulk-opplasting datablad" },
  { test: (p) => p === "/ravarer/fakturaer/til-behandling", label: "Til behandling" },
  { test: (p) => p.startsWith("/ravarer/fakturaer/import"), label: "Importer faktura" },
  { test: (p) => p.startsWith("/ravarer/fakturaer"), label: "Fakturaer" },
  { test: (p) => p.startsWith("/ravarer/innstillinger/match-toleranser"), label: "Match-toleranser" },
  { test: (p) => p.startsWith("/ravarer/innstillinger/tripletex"), label: "Tripletex-tilkobling" },
  { test: (p) => p.startsWith("/ravarer/innstillinger/kategorier"), label: "Kategorier" },
  { test: (p) => p.startsWith("/ravarer/innstillinger/ai-tjenester"), label: "AI-tjenester" },
  { test: (p) => p.startsWith("/ravarer/innstillinger"), label: "Innstillinger" },
  { test: (p) => p === "/ravarer", label: "Råvarer" },

  // Produksjon
  { test: (p) => p === "/produksjon" || p.startsWith("/produksjon/oversikt"), label: "Oversikt" },
  { test: (p) => p.startsWith("/produksjon/etiketter"), label: "Etiketter" },
  { test: (p) => p.startsWith("/produksjon/innstillinger/pakkeomrader"), label: "Pakkeområder" },
  { test: (p) => p.startsWith("/produksjon/innstillinger/produksjonsavdelinger"), label: "Produksjonsavdelinger" },
  { test: (p) => p.startsWith("/produksjon/innstillinger/utskriftsprofiler"), label: "Utskriftsprofiler" },
  { test: (p) => p.startsWith("/produksjon/innstillinger"), label: "Innstillinger" },
  { test: (p) => p.startsWith("/produksjon"), label: "Produksjon" },

  // Fakturering
  { test: (p) => p.startsWith("/fakturering/sok"), label: "Fakturasøk" },
  { test: (p) => p.startsWith("/fakturering/kjoringer"), label: "Kjøringer" },
  { test: (p) => p.startsWith("/fakturering/innstillinger"), label: "Innstillinger" },
  { test: (p) => p === "/fakturering", label: "Fakturakjøring" },
];

export function getPageLabel(pathname: string, fallback: string): string {
  for (const r of RULES) if (r.test(pathname)) return r.label;
  return fallback;
}
