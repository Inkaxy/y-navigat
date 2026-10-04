import { supabase } from "@/integrations/supabase/client";

const ERR: Record<string, string> = {
  forbidden: "Mangler skrivetilgang",
  linjene_maa_ha_samme_selskap_og_leverandor: "Linjene må høre til samme leverandør",
  linje_allerede_i_aapen_sak: "En av linjene ligger allerede i en åpen sak",
  prisgrunnlag_mangler: "En linje mangler dokumentert pris eller mengde",
  ingen_merkostnad: "En linje har ingen merkostnad",
  ikke_kreditnota: "Valgt dokument er ikke en kreditnota",
  kreditnota_annen_leverandor: "Kreditnotaen er fra en annen leverandør eller et annet selskap",
  faktura_ikke_i_saken: "Fakturaen hører ikke til saken",
  kreditnota_overfordelt: "Kreditnotaen har ikke så mye ufordelt beløp igjen",
  mer_enn_restavvik: "Beløpet er større enn fakturaens restavvik",
  sak_ikke_aapen: "Saken er ikke åpen",
  begrunnelse_mangler: "Skriv en begrunnelse",
  ugyldig_belop: "Ugyldig beløp",
};

export function caseErrorMessage(raw: string): string {
  const hit = Object.keys(ERR).find((k) => raw.includes(k));
  return hit ? ERR[hit] : "Lagringen ble avvist";
}

export async function createSupplierCase(args: { lineIds: string[]; title: string; reason?: string; followUpOn?: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc("create_supplier_deviation_case", {
    p_line_ids: args.lineIds,
    p_title: args.title,
    p_reason: args.reason ?? undefined,
    p_follow_up_on: args.followUpOn ?? undefined,
  });
  if (error) throw new Error(caseErrorMessage(error.message));
  return String((data as { case_id?: string }).case_id);
}

export async function allocateCredit(args: { caseId: string; creditInvoiceId: string; invoiceId: string; amountExclVat: number; clientRef: string; note?: string }) {
  const { data, error } = await supabase.rpc("allocate_supplier_deviation_credit", {
    p_case_id: args.caseId,
    p_credit_invoice_id: args.creditInvoiceId,
    p_invoice_id: args.invoiceId,
    p_amount_excl_vat: args.amountExclVat,
    p_client_ref: args.clientRef,
    p_note: args.note ?? undefined,
  });
  if (error) throw new Error(caseErrorMessage(error.message));
  return data as { ok: boolean; already_saved: boolean; remaining_excl_vat?: number };
}

export async function setCaseStatus(caseId: string, status: "open" | "resolved" | "cancelled", note: string) {
  const { error } = await supabase.rpc("set_supplier_deviation_case_status", { p_case_id: caseId, p_status: status, p_note: note });
  if (error) throw new Error(caseErrorMessage(error.message));
}

/**
 * Restavvik per faktura i en sak: koblede beløp minus kreditfordelt.
 * Kreditt på én faktura reduserer ALDRI en annen fakturas restavvik.
 */
export function remainingByInvoice(
  lines: ReadonlyArray<{ invoice_id: string; amount_excl_vat: number }>,
  credits: ReadonlyArray<{ invoice_id: string; amount_excl_vat: number }>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.invoice_id, (m.get(l.invoice_id) ?? 0) + Number(l.amount_excl_vat));
  for (const c of credits) m.set(c.invoice_id, (m.get(c.invoice_id) ?? 0) - Number(c.amount_excl_vat));
  for (const [k, v] of m) m.set(k, Math.round(v * 100) / 100);
  return m;
}

/** Klientkontroll (serveren kontrollerer det samme): største lovlige kredit. */
export function maxAllocatable(creditUnallocated: number, invoiceRemaining: number): number {
  return Math.max(0, Math.min(creditUnallocated, invoiceRemaining));
}

