// Livsløpsvakt for motorer som skriver til en faktura (match-invoice-lines).
// Fail-closed: aktiv intern godkjenning, utelatt eller endelig status => ingen skriving.
// Lesefeil gir aldri «tillatt».

export const FINAL_INVOICE_STATUSES = ["flagged", "reconciled", "cancelled", "excluded"] as const;

export type LifecycleDecision =
  | { kind: "open" }
  | { kind: "locked"; reason: "internally_approved" | "excluded" | "final_status"; status: string | null }
  | { kind: "error"; message: string };

type Res<T> = { data: T | null; error: { message: string } | null };

export interface LifecycleReader {
  activeApproval(invoiceId: string): PromiseLike<Res<{ id: string }[]>>;
}

export async function invoiceLifecycle(
  inv: { id: string; status: string | null; excluded_at: string | null },
  reader: LifecycleReader,
): Promise<LifecycleDecision> {
  const status = inv.status == null ? null : String(inv.status);
  if (inv.excluded_at) return { kind: "locked", reason: "excluded", status };
  if (status && (FINAL_INVOICE_STATUSES as readonly string[]).includes(status)) return { kind: "locked", reason: "final_status", status };
  let res: Res<{ id: string }[]>;
  try {
    res = await reader.activeApproval(inv.id);
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : "approval_read_failed" };
  }
  if (res.error || !Array.isArray(res.data)) return { kind: "error", message: res.error?.message ?? "approval_read_failed" };
  if (res.data.length > 0) return { kind: "locked", reason: "internally_approved", status };
  return { kind: "open" };
}

/** Leser aktiv godkjenning (status=approved og ikke tilbakekalt) med tjenesteklient. */
// deno-lint-ignore no-explicit-any
export function svcLifecycleReader(svc: any): LifecycleReader {
  return {
    activeApproval: (invoiceId) => svc.from("invoice_internal_approvals").select("id")
      .eq("invoice_id", invoiceId).eq("status", "approved").is("revoked_at", null).limit(1),
  };
}
