// Bygger docs/ravarer-funksjonsmapping.json: én post per original funksjons-ID (R1–R203, F1–F110).
// Kartlegging = kilde/rute-eier per seksjon + funksjonens egen «Ny plassering». Det er IKKE bevis på at handlingen virker.
import { readFileSync, writeFileSync } from "node:fs";
const SHA = process.argv[2] ?? "ukjent";
const md = readFileSync("docs/ravarer-funksjonsliste.md", "utf8");
const P = "src/ravarer/pages";
const OWNERS = [
  [/^Navigasjon/, "src/ravarer/routes.tsx", "src/ravarer/components/RavarerNav.tsx", "/ravarer"],
  [/^Vareliste/, "VareArbeidsflate", `${P}/VareArbeidsflate.tsx`, "/ravarer/varer?liste=:modus&valgt=:id"],
  [/^Råvarekort – header/, "RawMaterialDetail", `${P}/RawMaterialDetail.tsx`, "/ravarer/varer/:id"],
  [/^Råvarekort – Oversikt/, "RawMaterialDetail", `${P}/RawMaterialDetail.tsx`, "/ravarer/varer/:id?seksjon=sammendrag"],
  [/^Råvarekort – Priser/, "RawMaterialDetail", `${P}/RawMaterialDetail.tsx`, "/ravarer/varer/:id?seksjon=pris|leverandorer"],
  [/^Råvarekort – Næring/, "RawMaterialDetail", `${P}/RawMaterialDetail.tsx`, "/ravarer/varer/:id?seksjon=naering|deklarasjon"],
  [/^Råvarekort – Oppskrifter/, "RawMaterialDetail", `${P}/RawMaterialDetail.tsx`, "/ravarer/varer/:id?seksjon=bruk|lager|historikk"],
  [/^Lager$/, "LagerHub", `${P}/LagerHub.tsx`, "/ravarer/lager?fane=:fane"],
  [/^Varemottak/, "LagerHub", `${P}/LagerHub.tsx`, "/ravarer/lager?fane=mottak"],
  [/^Varetelling/, "LagerHub", `${P}/LagerHub.tsx`, "/ravarer/lager?fane=telling"],
  [/^Pakninger/, "VareArbeidsflate", `${P}/VareArbeidsflate.tsx`, "/ravarer/varer?liste=pakning"],
  [/^Deklarasjonsnavn/, "VareArbeidsflate", `${P}/VareArbeidsflate.tsx`, "/ravarer/varer?liste=deklarasjon"],
  [/^Matvaretabellen/, "Matvaretabellen", `${P}/Matvaretabellen.tsx`, "/ravarer/varer/matvaretabellen"],
  [/^Koble Matvaretabellen/, "RawMaterialDetail", `${P}/RawMaterialDetail.tsx`, "/ravarer/varer/:id?seksjon=naering"],
  [/^Leverandører$/, "LeverandorerHub", `${P}/LeverandorerHub.tsx`, "/ravarer/leverandorer?q=&valgt=:id"],
  [/^Leverandørkort/, "LeverandorDetail", `${P}/LeverandorDetail.tsx`, "/ravarer/leverandorer/:id?seksjon=:seksjon"],
  [/^Avtaler/, "LeverandorerHub", `${P}/LeverandorerHub.tsx`, "/ravarer/leverandorer?fane=avtaler"],
  [/^Datablad-endringer/, "VareArbeidsflate", `${P}/VareArbeidsflate.tsx`, "/ravarer/varer?liste=datablad"],
  [/^Datablad-opplasting/, "DatabladBulk", `${P}/DatabladBulk.tsx`, "/ravarer/varer/datablad-opplasting"],
  [/^Forhandlinger/, "Forhandlinger + portaler", `${P}/forhandlinger`, "/ravarer/leverandorer/forhandlinger/:id · /tilbud/:token · /bekreftelse/:token"],
  [/^Innstillinger/, "Innstillinger", `${P}/Innstillinger.tsx`, "/ravarer/innstillinger?fane=:fane"],
  [/^Reberegn/, "ReberegnKostpriser (kostpris 3D, gjennomgått etter 4621)", `${P}/priskontroll/ReberegnKostpriser.tsx`, "/ravarer/priskontroll/verktoy/reberegn"],
  [/^Ny råvare/, "NewRawMaterialDialog", "src/ravarer/components", "/ravarer/varer (dialog)"],
  [/^Fakturaer: I dag/, "Priskontroll", `${P}/Priskontroll.tsx`, "/ravarer/priskontroll?fane=gjore"],
  [/^Varekoblinger/, "AlleVarekort / VarekortPage", `${P}/priskontroll`, "/ravarer/priskontroll/varekort/:supplierId/:itemKey"],
  [/^Til behandling/, "Priskontroll", `${P}/Priskontroll.tsx`, "/ravarer/priskontroll?fane=gjore"],
  [/^Linjeoppgave/, "FakturaWorkspace", `${P}/priskontroll/faktura/FakturaWorkspace.tsx`, "/ravarer/priskontroll/faktura/:id?linje=:linje"],
  [/^Fakturaliste/, "Priskontroll", `${P}/Priskontroll.tsx`, "/ravarer/priskontroll?fane=fakturaer"],
  [/^Fakturadetalj/, "FakturaWorkspace (+ peek i Priskontroll)", `${P}/priskontroll/faktura/FakturaWorkspace.tsx`, "/ravarer/priskontroll/faktura/:id"],
  [/^Import/, "Priskontroll", `${P}/Priskontroll.tsx`, "/ravarer/priskontroll?fane=verktoy"],
  [/^Registrer linjer/, "RegistrerLinjer", `${P}/priskontroll/faktura`, "/ravarer/priskontroll/faktura/:id/registrer-linjer"],
  [/^Godkjenning/, "Priskontroll", `${P}/Priskontroll.tsx`, "/ravarer/priskontroll?fane=fakturaer"],
  [/^Leverandørsaker/, "SupplierCase (levende omslag)", `${P}/priskontroll/saker`, "/ravarer/priskontroll/saker/:id"],
  [/^Vareminne/, "AlleVarekort / VarekortPage", `${P}/priskontroll`, "/ravarer/priskontroll/varekort"],
  [/^Kryssmodul/, "Varer-modulen (oppskrift/produkt)", "src/varer", "/varer/oppskrifter/:id · /varer/vareliste/:id"],
  [/^Kjente hull/, "flere eiere", "src/ravarer", "se «Ny plassering»"],
];
let section = "";
const recs = [];
for (const line of md.split("\n")) {
  const h = line.match(/^## (.+)/);
  if (h) { section = h[1].trim(); continue; }
  const m = line.match(/^\| ([RF]\d+(?:, [RF]\d+)*) \| (.*)$/);
  if (!m || /^Fase 6/.test(section)) continue;
  const cells = m[2].split(/(?<!\\)\|/).map((c) => c.trim());
  const own = OWNERS.find(([re]) => re.test(section));
  for (const id of m[1].split(", ")) {
    recs.push({
      id, section, feature: cells[0],
      route_owner: own ? own[1] : "ukjent", component_path: own ? own[2] : "ukjent",
      canonical_url_template: own ? own[3] : "ukjent", section_or_action: cells[1] ?? "",
      source_sha: SHA,
      mapping_evidence: "Seksjonsoverskrift i funksjonslisten + «Ny plassering»; rute-eier fra src/ravarer/routes.tsx. Ikke handlingsbevis.",
      historical_status: cells[3] ?? "",
      implemented: "kilde-kartlagt", mocked_test: "ukjent", browser: "ukjent", accepted: "ikke akseptert",
    });
  }
}
writeFileSync("docs/ravarer-funksjonsmapping.json", JSON.stringify(recs, null, 1) + "\n");
console.log(recs.length, new Set(recs.map((r) => r.id)).size, recs.filter((r) => r.route_owner === "ukjent").length);
