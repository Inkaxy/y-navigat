/**
 * Kontekstuell hjelpetekst per side. Mest spesifikke treff først.
 * Brukes av Hjelp-knappen i topbaren.
 */
export type PageHelp = {
  title: string;
  body: string[];
};

const RULES: { test: (p: string) => boolean; help: PageHelp }[] = [
  // Ordre
  {
    test: (p) => p.startsWith("/ordre/leveranseplan"),
    help: {
      title: "Leveranseplan",
      body: [
        "Ukesoversikt som viser hvilke leveringsregler som gjelder per tur og ukedag.",
        "Bytt uke med pilene, filtrer på kunde eller regeltype, og hold musen over en brikke for full forklaring.",
      ],
    },
  },
  {
    test: (p) => p.startsWith("/ordre/leveringsregler"),
    help: {
      title: "Leveringsregler",
      body: [
        "Her styrer du ordrefrister, leveringsdager, hvilke turer og varer kunder kan bestille, samt stengte perioder.",
        "Hvert kort forteller i klartekst hva regelen definerer og hvem den gjelder for. Høyest prioritet vinner ved overlapp.",
      ],
    },
  },
  {
    test: (p) => p.startsWith("/ordre/pakksedler"),
    help: {
      title: "Pakksedler",
      body: [
        "Kjør hovedkjøring for en leveringsdag, se status for kjøringer og aktive leveransepauser.",
        "Kortene viser fastordre, daterte ordre, returordre og genererte pakksedler for valgt dato og tur.",
      ],
    },
  },
  {
    test: (p) => p.startsWith("/ordre/ordrer"),
    help: {
      title: "Bestillinger",
      body: [
        "Alle ordre i systemet. Bruk «Til godkjenning» for ordre som venter på godkjenning før de går i produksjon.",
      ],
    },
  },
  {
    test: (p) => p.startsWith("/ordre/leveringskalender"),
    help: {
      title: "Ordre-matrise",
      body: [
        "Matrise med kunder mot leveringsdager. Rediger antall direkte i cellene; endringer lagres samlet.",
      ],
    },
  },
  {
    test: (p) => p.startsWith("/ordre/ticket"),
    help: {
      title: "Ticket",
      body: [
        "Innboks for e-post fra kunder. AI foreslår kundematch, sammendrag og endringer du kan godkjenne.",
      ],
    },
  },
  {
    test: (p) => p.startsWith("/ordre"),
    help: {
      title: "Ordre",
      body: ["Bestillinger, pakksedler, turer og leveringsregler for Nøtterø Bakeri."],
    },
  },

  // Andre apper
  {
    test: (p) => p.startsWith("/fakturering"),
    help: {
      title: "Fakturering",
      body: ["Kjør fakturagrunnlag per periode og overfør til Tripletex som utkast."],
    },
  },
  {
    test: (p) => p.startsWith("/produksjon"),
    help: {
      title: "Produksjon",
      body: ["Produksjonsplan og etiketter basert på ordre i produksjons-scope."],
    },
  },
  {
    test: (p) => p.startsWith("/varer"),
    help: { title: "Varer", body: ["Vareregister, priser, oppskrifter og kakebygger."] },
  },
  {
    test: (p) => p.startsWith("/kunder"),
    help: { title: "Kunder", body: ["Kunderegister, kundegrupper, profiler og portaltilgang."] },
  },
  {
    test: (p) => p.startsWith("/ravarer"),
    help: { title: "Råvarer", body: ["Råvarer, leverandører, datablad og prisforhandlinger."] },
  },
  {
    test: (p) => p.startsWith("/pos-styring"),
    help: { title: "POS-styring", body: ["Kasser, sesjoner, Z-rapporter og SAF-T-eksport."] },
  },
  {
    test: (p) => p.startsWith("/admin"),
    help: { title: "Administrasjon", body: ["Selskaper, brukere, stillinger, apper og tilganger."] },
  },
];

const FALLBACK: PageHelp = {
  title: "NBHub",
  body: [
    "NBHub er hovedshellet for Nøtterø Bakeri. Appene du ser i toppmenyen styres av stillingene dine.",
  ],
};

export function getPageHelp(pathname: string): PageHelp {
  return RULES.find((r) => r.test(pathname))?.help ?? FALLBACK;
}
