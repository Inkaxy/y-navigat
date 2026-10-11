import type { SupplierItem, SupplierItemLine } from "@/fakturaer/lib/supplierItems";
import { costPostingAllowed } from "@/ravarer/pages/priskontroll/faktura/invoiceSteps";

export type FirstCostLine = Pick<SupplierItemLine, "id" | "invoice_id" | "invoice_status" | "is_credit_note" | "cost_posted" | "raw_material_id" | "price_per_base_unit" | "base_quantity" | "flagged_at">;

/**
 * F13 «Første kostpris» på tvers av fakturaer: varen mangler kostpris, og
 * linjene er trygge nok til at serveren kan føre dem (koblet råvare, kjent
 * mengde og pris, ikke ført, faktura i åpen status og ikke kreditnota).
 * Serveren (`rm_post_safe_line_costs`) avgjør endelig per linje.
 */
export function firstCostLinesByInvoice(item: Pick<SupplierItem, "rm_cost" | "rm_id">, lines: readonly FirstCostLine[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!item.rm_id || (item.rm_cost != null && item.rm_cost > 0)) return out;
  for (const l of lines) {
    if (l.flagged_at || l.cost_posted || !l.raw_material_id) continue;
    if (l.price_per_base_unit == null || l.base_quantity == null || l.base_quantity <= 0) continue;
    if (!costPostingAllowed({ status: l.invoice_status, is_credit_note: l.is_credit_note })) continue;
    out.set(l.invoice_id, [...(out.get(l.invoice_id) ?? []), l.id]);
  }
  return out;
}

export function firstCostReport(results: readonly { posted: number; error: string | null }[]): { title: string; items: string[] } {
  const posted = results.reduce((s, r) => s + r.posted, 0);
  const failed = results.filter((r) => r.error).length;
  const title = failed === 0 ? `Første kostpris ført: ${posted} linjer på ${results.length} fakturaer` : `${posted} linjer ført, ${failed} av ${results.length} fakturaer feilet`;
  return { title, items: results.flatMap((r) => (r.error ? [r.error] : [])) };
}
