import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/fakturaer/lib/constants";
import { allocateCredit, maxAllocatable } from "@/fakturaer/lib/supplierCases";
import { parseDecimal } from "@/fakturaer/lib/units";
import { invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import type { SupplierCaseData } from "./useSupplierCaseDetail";

const kr = (v: number) => formatMoney(v, "NOK");

/** «Fordel kreditnota»: idempotent via client_ref (samme innhold = samme nøkkel). */
export function CaseCreditForm({ d, invoices }: { d: SupplierCaseData; invoices: [string, string][] }) {
  const qc = useQueryClient();
  const [noteId, setNoteId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState(() => crypto.randomUUID());
  useEffect(() => { setRef(crypto.randomUUID()); }, [noteId, invoiceId, amount]);
  const parsed = parseDecimal(amount);
  const max = noteId && invoiceId ? maxAllocatable(d.unallocated(noteId), d.remaining.get(invoiceId) ?? 0) : 0;

  const alloc = useMutation({
    mutationFn: () => allocateCredit({ caseId: d.c.id, creditInvoiceId: noteId, invoiceId, amountExclVat: parsed ?? 0, clientRef: ref }),
    onSuccess: async (r) => {
      invalidateRavarerCounts(qc);
      toast.success(r.already_saved ? "Fordelingen var allerede lagret" : "Kreditten er fordelt på fakturaen");
      setAmount("");
      setRef(crypto.randomUUID());
      await qc.invalidateQueries({ queryKey: ["supplier-case", d.c.id] });
      void qc.invalidateQueries({ queryKey: ["supplier-cases"] });
      void qc.invalidateQueries({ queryKey: ["invoice-approval-overview"] });
      void qc.invalidateQueries({ queryKey: ["audit-history"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); alloc.mutate(); }}>
      <h3 className="font-semibold">Fordel kreditnota</h3>
      <div className="space-y-1">
        <Label htmlFor="credit-note">Kreditnota fra {d.c.supplier?.name}</Label>
        <select id="credit-note" className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={noteId} onChange={(e) => setNoteId(e.target.value)}>
          <option value="">Velg kreditnota</option>
          {d.notes.map((n) => <option key={n.id} value={n.id}>{n.invoice_number} · ufordelt {kr(d.unallocated(n.id))} ekskl. mva.</option>)}
        </select>
        {d.notes.length === 0 && <p className="text-sm text-ink-secondary">Ingen kreditnotaer fra denne leverandøren er importert.</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="credit-invoice">Gjelder faktura</Label>
        <select id="credit-invoice" className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
          <option value="">Velg faktura</option>
          {invoices.map(([i, no]) => <option key={i} value={i}>{no} · restavvik {kr(d.remaining.get(i) ?? 0)}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="credit-amount">Beløp ekskl. mva.</Label>
        <Input id="credit-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {noteId && invoiceId && <p className="text-sm text-ink-secondary">Maks {kr(max)} for denne fakturaen.</p>}
      </div>
      <Button type="submit" disabled={alloc.isPending || !noteId || !invoiceId || parsed == null || parsed <= 0 || parsed > max + 0.005}>
        {alloc.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Fordel kreditten
      </Button>
      <p className="text-sm text-ink-secondary">Kreditten reduserer bare valgt fakturas restavvik. Fakturaen godkjennes ikke automatisk.</p>
    </form>
  );
}
