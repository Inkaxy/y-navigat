/**
 * «Pliktfelt på etiketten»: én sjekkliste i stedet for to.
 *
 * Radene bygges fra `buildLabelChecklist` (samme regler og samme nivåer som
 * før). Her legges bare på hvilket felt som kan redigeres i raden, og om
 * feltet er påkrevd, anbefalt eller frivillig. Ingen regler endres.
 */
import type { ChecklistItem, ChecklistLevel } from "@/varer/lib/labelChecklist";

export type LabelFieldEditor = "net_weight" | "shelf_life" | "storage" | "origin";
export type LabelFieldRequirement = "påkrevd" | "anbefalt" | "frivillig";

export interface LabelFieldRow {
  key: string;
  label: string;
  /** «none» = frivillig felt som ikke er fylt ut (ingen feil). */
  level: ChecklistLevel | "none";
  requirement: LabelFieldRequirement;
  detail: string;
  editor: LabelFieldEditor | null;
}

const EDITOR: Record<string, LabelFieldEditor> = {
  net_weight: "net_weight",
  shelf_life: "shelf_life",
  storage: "storage",
};

/** Oppbevaring er gul i sjekklisten (anbefalt); spor og opprinnelse er frivillige. */
const REQUIREMENT: Record<string, LabelFieldRequirement> = {
  storage: "anbefalt",
  may_contain: "frivillig",
  origin: "frivillig",
};

const LABEL: Record<string, string> = {
  allergens: "Allergener",
  may_contain: "Kan inneholde spor",
  shelf_life: "Holdbarhet (dager)",
  nutrition: "Næringsinnhold",
};

export interface LabelFieldRows {
  required: LabelFieldRow[];
  other: LabelFieldRow[];
  /** Røde rader — samme tall som sperrer utskrift av kladden. */
  errorCount: number;
}

export function buildLabelFieldRows(
  checklist: ChecklistItem[],
  extra: { countryOfOrigin: string | null | undefined },
): LabelFieldRows {
  const rows: LabelFieldRow[] = [];
  for (const item of checklist) {
    rows.push({
      key: item.key,
      label: LABEL[item.key] ?? item.label,
      level: item.level,
      requirement: REQUIREMENT[item.key] ?? "påkrevd",
      detail: item.detail,
      editor: EDITOR[item.key] ?? null,
    });
    if (item.key === "storage") {
      const origin = (extra.countryOfOrigin ?? "").trim();
      rows.push({
        key: "origin",
        label: "Opprinnelse",
        level: origin ? "ok" : "none",
        requirement: "frivillig",
        detail: origin || "Valgfritt. Kreves når merkingen ellers kan villede forbrukeren.",
        editor: "origin",
      });
    }
  }
  return {
    required: rows.filter((r) => r.requirement === "påkrevd"),
    other: rows.filter((r) => r.requirement !== "påkrevd"),
    errorCount: rows.filter((r) => r.level === "error").length,
  };
}
