// «Godta som den er» og «Angre» (20261119_godta_sum). Svaret leses strengt; ukjent utfall kan gjentas med samme op_id
// (serveren gir samme svar), aldri et nytt kall med ny nøkkel før utfallet er kjent.
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callPendingRpc, type PendingResult } from "@/lib/pendingRpc";
import { parseSumWrite, type AcceptCategory, type SumWriteOutcome } from "@/ravarer/lib/fraFaktura/sumAccept";

function classify(r: PendingResult): SumWriteOutcome {
  if (r.kind === "ok") return parseSumWrite(r.data);
  if (r.kind === "missing") return { kind: "avvist", code: "ikke_kjort" };
  if (r.kind === "denied") return { kind: "avvist", code: "ingen_tilgang" };
  // Valideringsfeil fra serveren (22xxx) er sikker avvisning; alt annet er ukjent utfall.
  return r.code && /^22/.test(r.code) ? { kind: "avvist", code: "ugyldig" } : { kind: "ukjent" };
}

export function useSumAccept() {
  const qc = useQueryClient();
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["ravarer", "fra-faktura", "unread"] });
    void qc.invalidateQueries({ queryKey: ["ravarer", "work-items"] });
    void qc.invalidateQueries({ queryKey: ["ravarer", "work-summary"] });
  }, [qc]);
  const accept = useCallback(async (p: { invoiceId: string; updatedAt: string; category: AcceptCategory; reason: string; opId: string }) => {
    const r = classify(await callPendingRpc("rm_accept_invoice_sum", {
      p_invoice_id: p.invoiceId, p_category: p.category, p_reason: p.reason.trim() || null, p_expected_updated_at: p.updatedAt, p_op_id: p.opId,
    }));
    if (r.kind !== "ukjent") refresh();
    return r;
  }, [refresh]);
  const undo = useCallback(async (p: { auditId: string; opId: string }) => {
    const r = classify(await callPendingRpc("rm_undo_accept_invoice_sum", { p_audit_id: p.auditId, p_op_id: p.opId }));
    if (r.kind !== "ukjent") refresh();
    return r;
  }, [refresh]);
  return { accept, undo };
}
