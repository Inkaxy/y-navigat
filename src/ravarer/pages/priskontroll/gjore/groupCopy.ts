import type { WorkGroup, WorkItem, WorkItemKind, WorkItemsCounts } from "@/ravarer/lib/workRpcTypes";

/** Forklaring per gruppe i Å gjøre — vises som oppgaveoverskrift. */
export const GROUP_COPY: Record<WorkGroup, { title: string; explain: string }> = {
  alle: { title: "Alt som venter", explain: "Leverandørvarer og fakturaer som trenger en beslutning, sortert etter valgt rekkefølge." },
  kobling: { title: "Koble til råvare", explain: "Varer fra leverandøren som ikke er koblet til en råvare ennå. Én kobling gjelder alle åpne linjer for varen." },
  pakning: { title: "Bekreft pakning", explain: "Varen er koblet, men pakningen (f.eks. 25 kg sekk) er ikke bekreftet. Uten pakning kan prisen ikke sammenlignes." },
  pris: { title: "Vurder prisendring", explain: "Prisen avviker fra forventet. Godta ny pris eller krev kreditt fra leverandøren." },
  kontroll: { title: "Kontroller", explain: "Linjer med andre spørsmål, f.eks. usikker lesing eller avvik som ikke passer i de andre gruppene." },
  fakturaer: { title: "Fakturasaker", explain: "Fakturaer som mangler linjer, har sumavvik, er flagget eller er klare til avstemming." },
};

/** Hva brukeren gjør med raden — samme ord som panelets hovedknapp. */
export const NEXT_ACTION: Record<WorkItemKind, string> = {
  ukoblet: "Koble til råvare",
  mangler_pakning: "Bekreft pakning",
  prisavvik: "Vurder pris",
  kontroll: "Kontroller",
  faktura_mangler_linjer: "Hent eller registrer linjer",
  faktura_sumavvik: "Kontroller summen",
  faktura_flagget: "Følg opp flagg",
  faktura_klar: "Avstem fakturaen",
};

/** Kort årsak til at raden står i listen. */
export function causeText(it: Pick<WorkItem, "type" | "kind" | "open_lines" | "open_invoices">): string {
  switch (it.kind) {
    case "ukoblet": return "Ikke koblet til råvare";
    case "mangler_pakning": return "Pakning ikke bekreftet";
    case "prisavvik": return "Pris avviker fra forventet";
    case "kontroll": return "Må kontrolleres";
    case "faktura_mangler_linjer": return "Linjene er ikke lest inn";
    case "faktura_sumavvik": return "Linjesummen stemmer ikke med fakturaen";
    case "faktura_flagget": return "Flagget for oppfølging";
    case "faktura_klar": return "Alle linjer avklart";
  }
}

/** «12 leverandørvarer · 3 fakturasaker» for valgt gruppe. */
export function groupCountText(group: WorkGroup, counts: WorkItemsCounts | undefined): string | null {
  if (!counts) return null;
  const varer = group === "alle" ? Math.max(0, counts.alle - counts.fakturaer) : group === "fakturaer" ? 0 : counts[group];
  const saker = group === "alle" || group === "fakturaer" ? counts.fakturaer : 0;
  const parts: string[] = [];
  if (group !== "fakturaer") parts.push(`${varer} ${varer === 1 ? "leverandørvare" : "leverandørvarer"}`);
  if (group === "alle" || group === "fakturaer") parts.push(`${saker} ${saker === 1 ? "fakturasak" : "fakturasaker"}`);
  return parts.join(" · ");
}
