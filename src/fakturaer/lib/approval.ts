import { supabase } from "@/integrations/supabase/client";

/**
 * Intern fakturagodkjenning (attestasjon i NBhub). Den utløser IKKE betaling
 * og synkroniseres ikke til Tripletex. Kostprisføring er et eget løp.
 */
export interface OverviewRow {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  total_amount: number | null;
  total_vat: number | null;
  currency: string | null;
  status: string | null;
  is_credit_note: boolean;
  approved_at: string | null;
  approved_by: string | null;
  blockers: string[];
  open_material_lines: number;
  cost_posted_lines: number;
}

export type ApprovalBucket = "ready" | "waiting" | "done";

export const BLOCKER_LABEL: Record<string, string> = {
  flagget: "Fakturaen er flagget",
  kansellert: "Fakturaen er kansellert",
  sumavvik: "Linjesummen stemmer ikke med fakturabeløpet",
  mangler_linjer: "Fakturaen har ingen linjer",
  duplikat: "Samme fakturanummer finnes fra før hos leverandøren",
  mengde: "Mengde eller uttrekk på en linje må kontrolleres",
  prisavvik: "Prisavvik er ikke avklart",
  leverandorsak: "Holdes igjen av en åpen leverandørsak",
  finnes_ikke: "Fakturaen finnes ikke",
};

export function blockerLabel(code: string): string {
  return BLOCKER_LABEL[code] ?? "Kan ikke godkjennes ennå";
}

export function approvalBucket(r: Pick<OverviewRow, "approved_at" | "blockers">): ApprovalBucket {
  if (r.approved_at) return "done";
  return r.blockers.length === 0 ? "ready" : "waiting";
}

/** Beløp ekskl. mva fra lagret totalsum og mva — aldri gjettet. */
export function amountExclVat(total: number | null, vat: number | null): number | null {
  if (total == null) return null;
  return Math.round((Number(total) - Number(vat ?? 0)) * 100) / 100;
}

export async function fetchApprovalOverview(legalEntityId: string): Promise<OverviewRow[]> {
  const { data, error } = await supabase.rpc("invoice_approval_overview", { p_legal_entity_id: legalEntityId });
  if (error) throw new Error("Kunne ikke hente fakturaoversikten");
  return (data ?? []).map((r) => ({ ...r, blockers: r.blockers ?? [] })) as OverviewRow[];
}

export type ApproveResult = { invoiceId: string; ok: boolean; already: boolean; message: string | null };

export async function approveInvoiceInternal(invoiceId: string, note: string | null): Promise<ApproveResult> {
  const { data, error } = await supabase.rpc("approve_invoice_internal", { p_invoice_id: invoiceId, p_note: note ?? undefined });
  if (error) return { invoiceId, ok: false, already: false, message: /forbidden/.test(error.message) ? "Mangler skrivetilgang" : "Kunne ikke godkjenne" };
  const res = (data ?? {}) as { ok?: boolean; already_approved?: boolean; blockers?: string[] };
  if (res.ok !== true) return { invoiceId, ok: false, already: false, message: (res.blockers ?? []).map(blockerLabel).join(", ") || "Kunne ikke godkjenne" };
  return { invoiceId, ok: true, already: res.already_approved === true, message: null };
}

export async function revokeInvoiceApproval(invoiceId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_invoice_internal_approval", { p_invoice_id: invoiceId, p_reason: reason });
  if (error) throw new Error("Kunne ikke trekke tilbake godkjenningen");
}

/** Godkjenner valgte fakturaer én og én og rapporterer nøyaktig resultat per faktura. */
export async function approveMany(ids: readonly string[], note: string | null, approve = approveInvoiceInternal): Promise<ApproveResult[]> {
  const out: ApproveResult[] = [];
  for (const id of ids) out.push(await approve(id, note));
  return out;
}

export function summarizeResults(results: readonly { ok: boolean }[]): { ok: number; failed: number; text: string } {
  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  const text = failed === 0 ? `${ok} av ${results.length} lagret` : `${ok} av ${results.length} lagret, ${failed} feilet`;
  return { ok, failed, text };
}
