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
export async function postSafeCosts(
  invoiceIds: readonly string[],
  lineIds?: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<CostPostingResult[]> {
  const out: CostPostingResult[] = [];
  for (const invoiceId of invoiceIds) {
    const r = await postOne(invoiceId, lineIds);
    out.push(r);
    onProgress?.(out.length, invoiceIds.length);
  }
  return out;
}

async function postOne(invoiceId: string, lineIds?: readonly string[]): Promise<CostPostingResult> {
  try {
    const { data, error } = await supabase.rpc("rm_post_safe_line_costs", {
      p_invoice_id: invoiceId,
      p_line_ids: lineIds ? [...lineIds] : undefined,
    });
    if (error) {
      const k = Object.keys(ERR).find((x) => error.message.includes(x));
      return { invoiceId, posted: 0, skipped: 0, error: k ? ERR[k] : "Føringen ble avvist" };
    }
    const r = parseCostPostingJson(data);
    if (r.ok !== true) return { invoiceId, posted: 0, skipped: 0, error: `Fakturaen er sperret (${r.blockers.map(blockerLabel).join(", ")})` };
    return { invoiceId, posted: r.posted, skipped: r.skipped, error: null };
  } catch (e) {
    console.error("[for-kostpris]", e);
    return { invoiceId, posted: 0, skipped: 0, error: "Føringen ble avvist" };
  }
}

/** Typet lesing av svaret fra `rm_post_safe_line_costs`. */
export function parseCostPostingJson(v: unknown): { ok: boolean; posted: number; skipped: number; blockers: string[] } {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return {
    ok: o.ok === true,
    posted: Number.isFinite(Number(o.posted)) ? Number(o.posted) : 0,
    skipped: Array.isArray(o.skipped) ? o.skipped.length : 0,
    blockers: Array.isArray(o.blockers) ? o.blockers.filter((b): b is string => typeof b === "string") : [],
  };
}
