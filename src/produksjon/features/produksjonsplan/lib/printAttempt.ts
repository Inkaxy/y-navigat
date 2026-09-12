import { format } from "date-fns";
import { nb } from "date-fns/locale";
import type { ProductionPlanRow, ProduksjonsplanCriteria } from "../types";
import type { SnapshotItem } from "../hooks/useProductionPlanSnapshots";
import type { PrintProduksjonslisteOptions } from "../components/PrintProduksjonslisteDialog";
import type { ColumnVisibility } from "../components/ProductionPlanTable";

/** Visningsvalg som påvirker selve utskriften, fryst sammen med radene. */
export interface PrintViewPrefs {
  columns: ColumnVisibility;
  showByMainGroup: boolean;
  showTraysWithPlus: boolean;
}

export interface PrintOrderCounts {
  fast: number;
  datert: number;
  pakkseddel: number;
}

/**
 * Et utskriftsforsøk fryser HELE grunnlaget før det asynkrone snapshot-oppslaget
 * starter: dato, selskap, rader, kriterier, utskriftsvalg og headervisning.
 * Endrer brukeren dato eller kriterier mens oppslaget pågår, skal utskriften og
 * en eventuell ny baseline fortsatt gjelde det som faktisk ble skrevet ut.
 */
export interface PrintAttempt {
  /** Fryst id. Gjentatt bekreftelse av samme forsøk gir ikke ny baseline. */
  attemptId: string;
  legalEntityId: string;
  dateStr: string;
  /** Ferdig formatert dato-tekst i utskriftshodet. */
  dateLabel: string;
  /** Tidspunktet utskriften ble laget — fryses, ikke «nå» ved hver render. */
  printedAt: string;
  rows: ProductionPlanRow[];
  criteria: ProduksjonsplanCriteria;
  options: PrintProduksjonslisteOptions;
  correction: boolean;
  prevItems: Map<string, SnapshotItem> | null;
  prevTakenAt: string | null;
  /** Kolonner og visningsvalg slik de var da utskriften ble laget. */
  prefs: PrintViewPrefs;
  /** Ordretellingen i utskriftsfoten — fryses, leses aldri levende. */
  counts: PrintOrderCounts | null;
}

export type PrintGate =
  | { ok: true }
  | { ok: false; reason: "no_entity" | "plan_unavailable" | "busy" | "empty"; title: string; description: string };

export interface PrintGateInput {
  legalEntityId: string | null;
  /** Sant når planen laster, oppdaterer, har feilet eller mangler data. */
  planUnavailable: boolean;
  rowCount: number;
  /** Sant når et utskriftsforsøk allerede pågår eller venter på bekreftelse. */
  busy: boolean;
}

export function evaluatePrintGate(input: PrintGateInput): PrintGate {
  if (!input.legalEntityId) {
    return {
      ok: false,
      reason: "no_entity",
      title: "Velg selskap",
      description: "Utskriften trenger et valgt selskap.",
    };
  }
  if (input.busy) {
    return {
      ok: false,
      reason: "busy",
      title: "Utskrift pågår",
      description: "Fullfør eller avbryt forrige utskrift før du starter en ny.",
    };
  }
  if (input.planUnavailable) {
    return {
      ok: false,
      reason: "plan_unavailable",
      title: "Grunnlaget er ikke klart",
      description: "Produksjonsplanen er ikke ferdig oppdatert. Prøv igjen når tallene vises.",
    };
  }
  if (input.rowCount === 0) {
    return {
      ok: false,
      reason: "empty",
      title: "Ingen rader å skrive ut",
      description: "Produksjonslisten er tom.",
    };
  }
  return { ok: true };
}

export interface BuildPrintAttemptInput {
  attemptId: string;
  legalEntityId: string;
  dateStr: string;
  date: Date;
  rows: ProductionPlanRow[];
  criteria: ProduksjonsplanCriteria;
  options: PrintProduksjonslisteOptions;
  now: Date;
  prefs: PrintViewPrefs;
  counts: PrintOrderCounts | null;
  prev: { takenAt: string; items: Map<string, SnapshotItem> } | null;
  wantCorrection: boolean;
}

export function buildPrintAttempt(input: BuildPrintAttemptInput): PrintAttempt {
  return {
    attemptId: input.attemptId,
    legalEntityId: input.legalEntityId,
    dateStr: input.dateStr,
    dateLabel:
      `${format(input.date, "EEEE dd.MM.yy", { locale: nb })}` +
      (input.criteria.sum_tours ? " sum alle turer" : ""),
    printedAt: format(input.now, "dd.MM.yy HH:mm"),
    rows: input.rows.map((r) => ({ ...r })),
    criteria: { ...input.criteria },
    options: { ...input.options },
    correction: input.wantCorrection && !!input.prev,
    prevItems: input.prev?.items ?? null,
    prevTakenAt: input.prev?.takenAt ?? null,
    prefs: {
      columns: { ...input.prefs.columns },
      showByMainGroup: input.prefs.showByMainGroup,
      showTraysWithPlus: input.prefs.showTraysWithPlus,
    },
    counts: input.counts ? { ...input.counts } : null,
  };
}
