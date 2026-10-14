import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invalidateInvoice } from "@/ravarer/lib/invalidate";
import type { Json } from "@/integrations/supabase/types";
import { parseExclusionResult, type ExclusionCategory, type ExclusionResult, type ExclusionScope } from "@/fakturaer/lib/invoiceExclusion";

const isJson = (v: unknown): v is Json => v === null || typeof v === "object" || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

export type ExcludeInput = {
  invoiceId: string; scope: ExclusionScope; lineId: string | null;
  category: ExclusionCategory; reason: string; expectedUpdatedAt: string | null; opId: string;
};
export type ReopenInput = { invoiceId: string; scope: ExclusionScope; lineId: string | null; expectedUpdatedAt: string | null };

/**
 * Kall mot utelatelses-RPC-ene med synkron lås. Transportfeil uten SQL-svar er ukjent utfall
 * (samme opId kan sendes uendret på nytt; serveren svarer `already`).
 */
export function useInvoiceExclusion() {
  const qc = useQueryClient();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const after = (invoiceId: string) => {
    invalidateInvoice(qc, invoiceId);
    void qc.invalidateQueries({ queryKey: ["fakturaer-liste"] });
    void qc.invalidateQueries({ queryKey: ["supplier-items"] });
    void qc.invalidateQueries({ queryKey: ["supplier-item-lines"] });
  };
  async function run(invoiceId: string, call: () => PromiseLike<{ data: unknown; error: { code?: string } | null }>): Promise<ExclusionResult | { kind: "denied" }> {
    if (lock.current) return { kind: "unknown" };
    lock.current = true; setBusy(true);
    try {
      const { data, error } = await call();
      if (error) return error.code === "42501" ? { kind: "denied" } : { kind: "unknown" };
      const r = parseExclusionResult(isJson(data) ? data : null);
      if (r.kind === "ok") after(invoiceId);
      return r;
    } catch {
      return { kind: "unknown" };
    } finally { lock.current = false; setBusy(false); }
  }
  const exclude = (i: ExcludeInput) => run(i.invoiceId, () => supabase.rpc("rm_set_invoice_exclusion", {
    p_invoice_id: i.invoiceId, p_scope: i.scope, p_line_id: i.lineId ?? undefined,
    p_category: i.category, p_reason: i.reason.trim(), p_expected_updated_at: i.expectedUpdatedAt ?? "", p_op_id: i.opId,
  }));
  const reopen = (i: ReopenInput) => run(i.invoiceId, () => supabase.rpc("rm_reopen_invoice_exclusion", {
    p_invoice_id: i.invoiceId, p_scope: i.scope, p_line_id: i.lineId ?? undefined,
    p_expected_updated_at: i.expectedUpdatedAt ?? undefined,
  }));
  return { exclude, reopen, busy };
}
