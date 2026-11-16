import { useMemo, useRef, useState } from "react";
import { useCompany } from "@/hooks/useCompany";
import { useAcceptSupplierItemPrice } from "@/ravarer/hooks/useWorkData";
import { useLinkSupplierItem } from "@/fakturaer/hooks/useSupplierItems";
import { useInvoicePriceSafety } from "@/fakturaer/hooks/useInvoicePriceSafety";
import { useInvoiceExclusion } from "@/fakturaer/hooks/useInvoiceExclusion";
import { exclusionErrorText } from "@/fakturaer/lib/invoiceExclusion";
import { linkResultSummary, type SupplierItem, type SupplierItemLine } from "@/fakturaer/lib/supplierItems";
import { clarificationGate, priceCandidates, splitByGate } from "../priskontroll/gjore/PriceBlock";
import { acceptResultTitle, skipLineText } from "../priskontroll/gjore/logic";
import type { PanelResult } from "../priskontroll/gjore/types";
import { newOpId } from "@/lib/pendingRpc";
import type { SkipReason, UndoAnswer } from "@/ravarer/lib/quickAnswers";

export type QuickDone = { result: PanelResult; undo: UndoAnswer | null };

/**
 * Handlingene bak svarknappene. Samme skriveveier og samme prissperrer som varekortet:
 * prisen godtas bare for linjer serveren har kontrollert (rm_invoice_line_price_safety + linjeavklaring).
 * Én handling om gangen (synkron lås).
 */
export function useQuickAnswers(item: SupplierItem | null, lines: readonly SupplierItemLine[]) {
  const { data: company } = useCompany();
  const accept = useAcceptSupplierItemPrice();
  const link = useLinkSupplierItem();
  const excl = useInvoiceExclusion();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cands = useMemo(() => priceCandidates([...lines]), [lines]);
  const safety = useInvoicePriceSafety(cands.map((l) => l.invoice_id), { pending: accept.isPending, rawMaterialId: item?.rm_id ?? null });
  const { rows, blocked } = splitByGate(cands, (l) => clarificationGate(l, item) ?? safety.gateFor({ id: l.id, invoice_id: l.invoice_id }));
  const priceStatus: "ready" | "loading" | "error" = cands.length === 0 || safety.allFresh ? "ready" : safety.anyError ? "error" : "loading";
  const openLines = lines.filter((l) => l.requires_review === true);

  const run = async (fn: () => Promise<QuickDone | null>): Promise<QuickDone | null> => {
    if (lock.current) return null;
    lock.current = true; setBusy(true); setError(null);
    try { return await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : "Kunne ikke lagre."); return null; }
    finally { lock.current = false; setBusy(false); }
  };

  /** «Ja, godta»: alle serverkontrollerte prislinjer, med prisen brukeren så (serveren avviser endret pris). */
  const acceptAll = () => run(async () => {
    if (!item) return null;
    if (priceStatus !== "ready" || rows.length === 0) { setError("Ingen linjer er kontrollert for godkjenning ennå."); return null; }
    const r = await accept.mutateAsync({ supplierId: item.supplier_id, itemKey: item.item_key, lines: rows.map((x) => ({ id: x.id, price_per_base_unit: x.price_per_base_unit })), reason: "Godtatt i Beslutninger" });
    if (r.accepted === 0) {
      const why = [...new Set(r.skipped_lines.map(skipLineText))];
      setError(`Ingen linjer ble godtatt${why.length ? `: ${why.join("; ")}` : "."}`);
      return null;
    }
    const acceptedIds = rows.map((x) => x.id).filter((id) => !r.skipped_lines.some((s) => s.id === id));
    return {
      result: { title: acceptResultTitle(r.accepted, r.invoices.length), items: r.skipped_lines.map(skipLineText) },
      undo: acceptedIds.length ? { kind: "pris", lineIds: acceptedIds, label: `Godtatt pris for ${item.rm_name ?? item.description ?? "varen"}`, at: new Date().toISOString() } : null,
    };
  });

  /** «Hopp over alltid»: dagens «Ikke vare» (lager regel for fremtidige fakturaer fra leverandøren). */
  const skipAlways = (reason: SkipReason) => run(async () => {
    if (!item || !company) return null;
    const ids = openLines.map((l) => l.id);
    if (ids.length === 0) { setError("Ingen åpne linjer i utvalget. Trykk «Oppdater» først."); return null; }
    const r = await link.mutateAsync({ legal_entity_id: company.id, supplier_id: item.supplier_id, item_key: item.item_key, not_raw_material: true, reason, line_ids: ids });
    return {
      result: { title: `Hoppes over alltid (${reason})`, items: linkResultSummary(r) },
      undo: { kind: "ikke_vare", supplierId: item.supplier_id, itemKey: item.item_key, lineIds: ids, label: `Hopp over alltid: ${item.description ?? "linjen"}`, at: new Date().toISOString() },
    };
  });

  /** «Hopp over én gang»: hold linjene utenfor (dagens rm_set_invoice_exclusion), ingen regel. Stopper ved første uklare utfall. */
  const skipOnce = (reason: SkipReason) => run(async () => {
    if (!item) return null;
    if (openLines.length === 0) { setError("Ingen åpne linjer i utvalget."); return null; }
    const done: { invoiceId: string; lineId: string; updatedAt: string | null }[] = [];
    const notes: string[] = [];
    for (const l of openLines) {
      const r = await excl.exclude({ invoiceId: l.invoice_id, scope: "line", lineId: l.id, category: "annet",
        reason: `${reason} – hoppet over én gang i Beslutninger`, expectedUpdatedAt: l.line_updated_at ?? null, opId: newOpId() });
      if (r.kind === "ok") { done.push({ invoiceId: l.invoice_id, lineId: l.id, updatedAt: r.updatedAt }); continue; }
      if (r.kind === "rejected") { notes.push(`Faktura ${l.invoice_number ?? "uten nummer"}: ${exclusionErrorText(r)}`); continue; }
      notes.push(r.kind === "denied" ? "Du har ikke skrivetilgang til fakturaer." : `Faktura ${l.invoice_number ?? "uten nummer"}: utfallet er ukjent. Kontroller fakturaen før du prøver igjen.`);
      break;
    }
    if (done.length === 0) { setError(notes.join(" ") || "Ingenting ble lagret."); return null; }
    return {
      result: { title: `Hoppet over én gang (${done.length} ${done.length === 1 ? "linje" : "linjer"})`, items: notes },
      undo: { kind: "en_gang", lines: done, label: `Hopp over én gang: ${item.description ?? "linjen"}`, at: new Date().toISOString() },
    };
  });

  return { rows, blocked, priceStatus, openLines, busy: busy || accept.isPending || link.isPending || excl.busy, error, setError, acceptAll, skipAlways, skipOnce, retrySafety: safety.refetch };
}
