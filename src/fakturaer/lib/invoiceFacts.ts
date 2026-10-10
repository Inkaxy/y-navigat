import type { RepairVatResult } from "@/fakturaer/lib/parseRpcJson";

export type SumCheck = { label: string; tone: "success" | "danger" | "muted" };

/** Avvik mot netto: ≤ 2 % stemmer, ellers avviker; null = ikke kontrollert. */
export function sumCheck(variancePct: number | null | undefined): SumCheck {
  if (variancePct == null || !Number.isFinite(variancePct)) return { label: "ikke kontrollert", tone: "muted" };
  return Math.abs(variancePct) <= 2 ? { label: "stemmer", tone: "success" } : { label: "avviker", tone: "danger" };
}

export function confidenceLabel(c: number | null | undefined): string {
  if (c == null || !Number.isFinite(c)) return "—";
  if (c >= 0.85) return "høy";
  if (c >= 0.6) return "middels";
  return "lav";
}

export function linesSourceLabel(s: string | null | undefined): string {
  switch (s) {
    case "pdf_extracted": return "Lest fra PDF";
    case "manual": return "Registrert manuelt";
    case "pending_manual": return "Venter på manuell registrering";
    default: return "—";
  }
}

const REPAIR_REASON: Record<string, string> = {
  avstemt: "Fakturaen er avstemt",
  kostpris_fort: "Kostpris er allerede ført fra denne fakturaen",
  ikke_mva_monster: "Avviket ser ikke ut som en mva-feil",
  ingen_linjer_eller_sum: "Mangler linjer eller beløp",
  netto_null: "Nettobeløpet er null",
  finnes_ikke: "Fakturaen finnes ikke",
};

export function repairVatMessage(r: RepairVatResult): string {
  if (r.ok) {
    return r.mode === "linjer_skalert"
      ? `Linjesummene var delt på mva én gang for mye — rettet, ${r.lines} ${r.lines === 1 ? "linje regnes" : "linjer regnes"} om`
      : "Mva-beløp manglet fra Tripletex — utledet fra linjesummen";
  }
  return REPAIR_REASON[r.reason] ?? "Mva-avviket kunne ikke rettes";
}
