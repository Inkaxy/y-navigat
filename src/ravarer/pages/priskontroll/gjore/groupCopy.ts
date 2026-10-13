import { ACTION_COPY, type ActionRequired } from "@/fakturaer/lib/financialPresentation";
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

/** Serverhandlinger som overstyrer den generelle kind-teksten (kreditt, valuta, prisgrunnlag, lesing). */
const OVERRIDING: readonly ActionRequired[] = ["review_credit_note", "review_currency", "confirm_price_basis", "review_reading"];
const CAUSE_FOR_ACTION: Partial<Record<ActionRequired, string>> = {
  review_credit_note: "Kreditnota – ikke en prisendring",
  review_currency: "Fakturaen er ikke i NOK",
  confirm_price_basis: "Prisgrunnlaget er ikke bekreftet",
  review_reading: "Tallene er ikke kontrollert mot originalen",
};
function overriding(it: Pick<WorkItem, "action_required" | "kind">): ActionRequired | null {
  const a = it.action_required;
  if (!a) return null;
  if (OVERRIDING.includes(a)) return a;
  // En varelinje i prisgruppen som egentlig mangler kobling/pakning skal ikke kalles prisavvik.
  if (a === "complete_link_or_package" && it.kind === "prisavvik") return a;
  return null;
}

/** Neste handling for raden: serverens action_required når den er mer presis enn kind. */
export function nextActionText(it: Pick<WorkItem, "action_required" | "kind">): string {
  const a = overriding(it);
  return a ? ACTION_COPY[a].label : NEXT_ACTION[it.kind];
}

/** Kort årsak til at raden står i listen. */
export function causeText(it: Pick<WorkItem, "type" | "kind" | "open_lines" | "open_invoices"> & Partial<Pick<WorkItem, "action_required">>): string {
  const a = overriding({ action_required: it.action_required ?? null, kind: it.kind });
  if (a) return CAUSE_FOR_ACTION[a] ?? "Kobling eller pakning mangler";
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

/**
 * Overskrift for valgt element i arbeidsbordet. Et varekort med flere fakturaer får ikke én fakturas
 * årsak (f.eks. en gammel kreditnota) som merkelapp for hele kortet; avklaringene vises per faktura i panelet.
 */
export function detailCause(it: Pick<WorkItem, "type" | "kind" | "open_lines" | "open_invoices"> & Partial<Pick<WorkItem, "action_required">>): { cause: string; next: string } {
  const multi = it.type === "varekort" && (it.open_invoices ?? 0) > 1;
  if (multi && overriding({ action_required: it.action_required ?? null, kind: it.kind })) {
    const base = it.kind === "prisavvik" ? "Registrert mulig prisavvik" : causeText({ ...it, action_required: null });
    return { cause: `${base} · ${it.open_lines} åpne linjer på ${it.open_invoices} fakturaer`, next: "Se avklaringene per faktura nedenfor" };
  }
  return { cause: causeText(it), next: nextActionText({ kind: it.kind, action_required: it.action_required ?? null }) };
}
