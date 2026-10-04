import { blockerLabel } from "@/fakturaer/lib/approval";
import { supabase } from "@/integrations/supabase/client";

export interface CostPostingResult {
  invoiceId: string;
  posted: number;
  skipped: number;
  error: string | null;
}

const ERR: Record<string, string> = {
  forbidden: "Mangler skrivetilgang",
  kreditnota: "Kreditnotaer føres ikke som kostpris",
  faktura_status: "Fakturaen kan ikke behandles i denne statusen",
  valuta: "Kostpris føres bare i NOK",
  prishistorikk_feilet: "Prishistorikken kunne ikke føres",
};

/**
 * Fører kostpris for de trygge linjene på hver faktura (bekreftet råvare,
 * dokumentert mengde og pris). Usikre linjer hoppes over og blokkerer ikke
 * resten. Første dokumenterte kostpris uten avtale føres med kilde.
 * Sumavvik, duplikat og flagg på fakturaen stopper føringen.
 */
export async function postSafeCosts(invoiceIds: readonly string[], lineIds?: readonly string[]): Promise<CostPostingResult[]> {
  const out: CostPostingResult[] = [];
  for (const invoiceId of invoiceIds) {
    const { data, error } = await supabase.rpc("rm_post_safe_line_costs", {
      p_invoice_id: invoiceId,
      p_line_ids: lineIds ? [...lineIds] : undefined,
    });
    if (error) {
      const k = Object.keys(ERR).find((x) => error.message.includes(x));
      out.push({ invoiceId, posted: 0, skipped: 0, error: k ? ERR[k] : "Føringen ble avvist" });
      continue;
    }
    const r = (data ?? {}) as { ok?: boolean; posted?: number; skipped?: unknown[]; blockers?: string[] };
    if (r.ok !== true) {
      out.push({ invoiceId, posted: 0, skipped: 0, error: `Fakturaen er sperret (${(r.blockers ?? []).map(blockerLabel).join(", ")})` });
      continue;
    }
    out.push({ invoiceId, posted: Number(r.posted ?? 0), skipped: Array.isArray(r.skipped) ? r.skipped.length : 0, error: null });
  }
  return out;
}
