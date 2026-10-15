/**
 * Fakturaarbeidsflaten (`?fane=arbeid`): fire tilstander, eldste først, ett valg.
 * Rene funksjoner — testes uten React.
 */
import type { FakturaSort } from "../fakturaer/fakturaListLogic";
import type { FakturaVisning } from "../fakturaer/visning";

export const ARBEID_STATES = ["trenger", "klare", "etterkontroll", "ferdig", "utenfor"] as const;
export type ArbeidState = (typeof ARBEID_STATES)[number];

export const ARBEID_LABEL: Record<ArbeidState, string> = {
  trenger: "Trenger deg",
  klare: "Klare",
  etterkontroll: "Godkjent – etterkontroll",
  ferdig: "Avstemt",
  utenfor: "Holdt utenfor",
};

/** Hva hver tilstand betyr — vises som forklaring, så tallene ikke blandes. */
export const ARBEID_HINT: Record<ArbeidState, string> = {
  trenger: "Fakturaer med linjer eller summer som må avklares.",
  klare: "Alle linjer er avklart; fakturaen kan avstemmes.",
  etterkontroll: "Internt godkjent, men ikke avstemt. Åpnes bare for eksplisitt ny kontroll; godkjenningen endres ikke her.",
  ferdig: "Avstemt. Avstemt er ett steg — godkjenning og kostføring vises på fakturaen.",
  utenfor: "Holdt utenfor råvarebehandling med begrunnelse.",
};

/** Samme liste og samme serverstatus som Fakturalisten. */
export const ARBEID_TO_VISNING: Record<ArbeidState, FakturaVisning> = {
  trenger: "trenger",
  klare: "klar",
  etterkontroll: "etterkontroll",
  ferdig: "avstemt",
  utenfor: "utenfor",
};

export function parseArbeid(sp: URLSearchParams): { state: ArbeidState; newestFirst: boolean; selected: string | null } {
  const raw = sp.get("vis");
  const state = raw && (ARBEID_STATES as readonly string[]).includes(raw) ? (raw as ArbeidState) : "trenger";
  return { state, newestFirst: sp.get("rekkefolge") === "nyeste", selected: sp.get("valgt") || null };
}

/** Eldste fakturadato først som standard; nyeste kan velges. */
export function arbeidSort(newestFirst: boolean): NonNullable<FakturaSort> {
  return { id: "dato", dir: newestFirst ? "desc" : "asc" };
}

/** Teller for visning: ukjent (lasting/feil) er «–», aldri 0. */
export function countLabel(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("nb-NO") : "–";
}

export type Position = {
  /** Valgt faktura finnes i den ferske listen. */
  inList: boolean;
  index: number;
  prevId: string | null;
  nextId: string | null;
};

/**
 * Plassering av valgt faktura i listen. Har valgt faktura forsvunnet fra
 * listen (serveren har flyttet den), er «neste» den første gjenstående —
 * aldri den samme fakturaen.
 */
export function positionOf(ids: readonly string[], selected: string | null): Position {
  const index = selected ? ids.indexOf(selected) : -1;
  if (index < 0) {
    const nextId = ids.find((x) => x !== selected) ?? null;
    return { inList: false, index: -1, prevId: null, nextId };
  }
  return { inList: true, index, prevId: index > 0 ? ids[index - 1] : null, nextId: index < ids.length - 1 ? ids[index + 1] : null };
}

/** Tilstanden serveren faktisk viser for en faktura (samme klassedeling som listene). */
export function arbeidClassOf(status: string | null | undefined, internallyApproved: boolean): ArbeidState | null {
  if (status === "reconciled") return "ferdig";
  if (status === "excluded") return "utenfor";
  if (internallyApproved) return "etterkontroll";
  if (status === "ready") return "klare";
  if (status == null) return null;
  return "trenger";
}

export type ReceiptInput = {
  selected: string | null;
  state: ArbeidState;
  /** Nøkkel for selskap/tilstand/filter/side/rekkefølge for gjeldende liste. */
  scopeKey: string;
  /** Sist bekreftet at valgt faktura stod i en fersk liste med denne nøkkelen. */
  witnessed: { id: string; scopeKey: string } | null;
  /** Fakturaen er lest på nytt fra serveren etter at den ble sett i listen (faktisk lagring). */
  refreshedAfterWitness: boolean;
  /** Fersk liste: ikke lasting/feil/henting/plassholder, og detaljene er ferdig hentet. */
  settled: boolean;
  inList: boolean;
  detailStatus: string | null | undefined;
  detailApproved: boolean;
};

/**
 * «Flyttet»-kvittering bare for en kjent før→etter-overgang i samme utvalg, der fersk
 * servertilstand faktisk tilhører en annen tilstand. Ellers nøytralt «ikke i utvalget».
 */
export function arbeidReceipt(i: ReceiptInput): "moved" | "not_in_scope" | null {
  if (!i.selected || !i.settled || i.inList) return null;
  const known = i.witnessed?.id === i.selected && i.witnessed.scopeKey === i.scopeKey && i.refreshedAfterWitness;
  const cls = arbeidClassOf(i.detailStatus, i.detailApproved);
  if (known && cls != null && cls !== i.state) return "moved";
  return "not_in_scope";
}

/** Automatisk førstevalg bare fra en fersk liste for gjeldende parametre. */
export function canAutoSelect(a: { selected: string | null; isLoading: boolean; error: unknown; isFetching: boolean; isPlaceholderData: boolean; count: number }): boolean {
  return !a.selected && !a.isLoading && !a.error && !a.isFetching && !a.isPlaceholderData && a.count > 0;
}
