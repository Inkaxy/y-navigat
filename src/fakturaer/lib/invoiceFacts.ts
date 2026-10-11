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

/**
 * Lesingens pålitelighet. Modellens lagrede score er bare en rå AI-score; den gir aldri
 * «høy sikkerhet» når sumkontrollen avviker eller linjer har lesevarsler.
 */
export function readingReliability(i: {
  confidence: number | null | undefined; linesSumStatus: string | null | undefined; variancePct?: number | null; readIssueCount?: number | null;
}): { label: string; validated: boolean; rawScore: string | null } {
  const raw = i.confidence != null && Number.isFinite(i.confidence) ? `${Math.round(i.confidence * 100)} %` : null;
  const mismatch = i.linesSumStatus === "mismatch" || (i.variancePct != null && Number.isFinite(i.variancePct) && Math.abs(i.variancePct) > 2);
  const issues = (i.readIssueCount ?? 0) > 0;
  if (mismatch || issues) return { label: mismatch ? "Ikke bekreftet – sum avviker" : "Ikke bekreftet – lesevarsler", validated: false, rawScore: raw };
  if (raw == null) return { label: "—", validated: false, rawScore: null };
  return { label: `${confidenceLabel(i.confidence)} sikkerhet`, validated: i.linesSumStatus != null, rawScore: raw };
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
  if (r.kind === "forslag") {
    const f = r.factor != null ? String(r.factor).replace(".", ",") : "mva-satsen";
    return r.suggestion === "linjer_skalert"
      ? `Linjesummen avviker med samme forhold som mva (×${f}). Det kan være feil lesing — eller en manglende linje. Ingen beløp er endret: kontroller mot originalen og rett linjene med «Rett fakturalinje».`
      : `Mva mangler fra Tripletex, og linjesummen passer med mva ×${f}. Mva er ikke utledet automatisk: kontroller mot originalen.`;
  }
  return REPAIR_REASON[r.reason] ?? "Avviket kunne ikke kontrolleres";
}
