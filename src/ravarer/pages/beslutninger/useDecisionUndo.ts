import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/hooks/useCompany";
import { callPendingRpc, useCapability } from "@/lib/pendingRpc";
import { useInvoiceExclusion } from "@/fakturaer/hooks/useInvoiceExclusion";
import { invalidateInvoice, invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import { clearLastAnswer, loadLastAnswer, parseUndoResult, undoNeedsSql, undoSummary, type UndoAnswer } from "@/ravarer/lib/quickAnswers";

export type UndoState = { kind: "idle" } | { kind: "busy" } | { kind: "done"; text: string } | { kind: "error"; text: string };

/**
 * «Angre» på et svar. Pris og «Ikke vare» krever PENDING-SQL fase 1 (`rm_cap_beslutninger_v1`); før den
 * er kjørt vises ingen knapp. «Hopp over én gang» angres med dagens rm_reopen_invoice_exclusion.
 * Ukjent utfall sendes aldri automatisk på nytt.
 */
export function useDecisionUndo() {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const cap = useCapability("rm_cap_beslutninger_v1");
  const excl = useInvoiceExclusion();
  const lock = useRef(false);
  const [state, setState] = useState<UndoState>({ kind: "idle" });
  const [tick, setTick] = useState(0);
  const last = company ? loadLastAnswer(company.id) : null;
  void tick;

  const canUndo = (u: UndoAnswer | null): boolean => !!u && (!undoNeedsSql(u) || cap === true);

  const undo = async (u: UndoAnswer) => {
    if (lock.current || !company || !canUndo(u)) return;
    lock.current = true; setState({ kind: "busy" });
    const companyId = company.id;
    try {
      if (u.kind === "en_gang") {
        let ok = 0; const notes: string[] = [];
        for (const l of u.lines) {
          const r = await excl.reopen({ invoiceId: l.invoiceId, scope: "line", lineId: l.lineId, expectedUpdatedAt: l.updatedAt });
          if (r.kind === "ok") { ok += 1; continue; }
          notes.push(r.kind === "rejected" ? "en linje er endret siden og må gjenåpnes på fakturaen" : "utfallet er ukjent – kontroller fakturaen");
          if (r.kind !== "rejected") break;
        }
        setState(ok > 0 ? { kind: "done", text: `${ok} ${ok === 1 ? "linje er" : "linjer er"} åpne spørsmål igjen.${notes.length ? ` ${[...new Set(notes)].join("; ")}.` : ""}` }
          : { kind: "error", text: `Ingenting ble angret: ${[...new Set(notes)].join("; ")}.` });
      } else {
        const r = u.kind === "pris"
          ? await callPendingRpc("rm_undo_price_acceptance", { p_legal_entity_id: companyId, p_line_ids: u.lineIds })
          : await callPendingRpc("rm_undo_not_item", { p_legal_entity_id: companyId, p_supplier_id: u.supplierId, p_item_key: u.itemKey, p_line_ids: u.lineIds, p_remove_rule: true });
        if (r.kind === "missing") { setState({ kind: "error", text: "Angre venter på databaseendringen." }); return; }
        if (r.kind === "denied") { setState({ kind: "error", text: "Du har ikke skrivetilgang til fakturaer." }); return; }
        const o = r.kind === "ok" ? parseUndoResult(r.data) : null;
        if (!o) { setState({ kind: "error", text: "Utfallet er ukjent. Kontroller varekortet før du prøver igjen." }); return; }
        setState(o.undone > 0 ? { kind: "done", text: undoSummary(o) } : { kind: "error", text: undoSummary(o) });
      }
      clearLastAnswer(companyId); setTick((n) => n + 1);
    } finally {
      lock.current = false;
      invalidateInvoice(qc); invalidateRavarerCounts(qc);
      void qc.invalidateQueries({ queryKey: ["supplier-items"] });
      void qc.invalidateQueries({ queryKey: ["supplier-item-lines"] });
      void qc.invalidateQueries({ queryKey: ["ravarer", "work-items"] });
    }
  };
  return { last, canUndo, undo, state, reset: () => setState({ kind: "idle" }), refresh: () => setTick((n) => n + 1) };
}
