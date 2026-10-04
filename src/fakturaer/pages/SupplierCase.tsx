import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QueryState } from "@/components/common/QueryState";
import { DecisionNav } from "@/fakturaer/components/decisions/DecisionNav";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/fakturaer/lib/constants";
import { amountExclVat } from "@/fakturaer/lib/approval";
import { allocateCredit, maxAllocatable, remainingByInvoice, setCaseStatus } from "@/fakturaer/lib/supplierCases";
import { parseDecimal } from "@/fakturaer/lib/units";

const kr = (v: number | null | undefined) => (v == null ? "–" : formatMoney(v, "NOK"));
const STATUS: Record<string, string> = { open: "Åpen", resolved: "Løst", cancelled: "Avbrutt" };

export default function SupplierCase() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["supplier-case", id],
    queryFn: async () => {
      const { data: c, error } = await supabase
        .from("supplier_deviation_cases")
        .select("id, legal_entity_id, supplier_id, title, reason, status, follow_up_on, resolution_note, created_at, supplier:suppliers(name)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!c) return null;
      const [lines, credits, notes] = await Promise.all([
        supabase.from("supplier_deviation_case_lines").select("id, invoice_id, invoice_line_id, amount_excl_vat, invoice:invoices(invoice_number), line:invoice_lines(description)").eq("case_id", id).limit(500),
        supabase.from("supplier_deviation_credits").select("id, invoice_id, credit_invoice_id, amount_excl_vat, note, created_at, credit:invoices!supplier_deviation_credits_credit_invoice_id_fkey(invoice_number)").eq("case_id", id).limit(500),
        supabase.from("invoices").select("id, invoice_number, invoice_date, total_amount, total_vat").eq("supplier_id", c.supplier_id).eq("legal_entity_id", c.legal_entity_id).eq("is_credit_note", true).order("invoice_date", { ascending: false }).limit(100),
      ]);
      for (const r of [lines, credits, notes]) if (r.error) throw r.error;
      const noteIds = (notes.data ?? []).map((n) => n.id);
      const used = noteIds.length
        ? await supabase.from("supplier_deviation_credits").select("credit_invoice_id, amount_excl_vat").in("credit_invoice_id", noteIds).limit(1000)
        : { data: [], error: null };
      if (used.error) throw used.error;
      return { c, lines: lines.data ?? [], credits: credits.data ?? [], notes: notes.data ?? [], used: used.data ?? [] };
    },
  });

  const remaining = useMemo(() => (q.data ? remainingByInvoice(q.data.lines, q.data.credits) : new Map<string, number>()), [q.data]);
  const unallocated = (noteId: string) => {
    const n = q.data?.notes.find((x) => x.id === noteId);
    if (!n) return 0;
    const total = Math.abs(amountExclVat(n.total_amount, n.total_vat) ?? 0);
    const used = (q.data?.used ?? []).filter((u) => u.credit_invoice_id === noteId).reduce((s, u) => s + Number(u.amount_excl_vat), 0);
    return Math.round((total - used) * 100) / 100;
  };

  const [noteId, setNoteId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState(() => crypto.randomUUID());
  const [statusNote, setStatusNote] = useState("");
  const parsed = parseDecimal(amount);
  const max = noteId && invoiceId ? maxAllocatable(unallocated(noteId), remaining.get(invoiceId) ?? 0) : 0;

  const refresh = () => qc.invalidateQueries({ queryKey: ["supplier-case", id] }).then(() => qc.invalidateQueries({ queryKey: ["invoice-approval-overview"] }));
  const alloc = useMutation({
    mutationFn: () => allocateCredit({ caseId: id, creditInvoiceId: noteId, invoiceId, amountExclVat: parsed ?? 0, clientRef: ref }),
    onSuccess: async (r) => {
      toast.success(r.already_saved ? "Fordelingen var allerede lagret" : "Kreditten er fordelt på fakturaen");
      setAmount("");
      setRef(crypto.randomUUID());
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const status = useMutation({
    mutationFn: (s: "open" | "resolved" | "cancelled") => setCaseStatus(id, s, statusNote),
    onSuccess: async () => { toast.success("Status lagret"); await refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const d = q.data;
  const invoices = d ? [...new Map(d.lines.map((l) => [l.invoice_id, l.invoice?.invoice_number ?? l.invoice_id])).entries()] : [];
  const total = d ? d.lines.reduce((s, l) => s + Number(l.amount_excl_vat), 0) : 0;

  return (
    <div className="px-page py-6 space-y-6">
      <DecisionNav />
      <Link to="/ravarer/fakturaer/saker" className="text-sm text-primary hover:underline">← Leverandørsaker</Link>
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} scope="fakturaer:leverandorsak" onRetry={() => q.refetch()} isEmpty={!d} emptyTitle="Saken finnes ikke">
        {d && (
          <>
            <header className="space-y-1">
              <p className="text-caption uppercase tracking-wide text-ink-secondary">{d.c.supplier?.name} · {STATUS[d.c.status] ?? d.c.status}</p>
              <h1 className="font-display text-3xl font-semibold">{d.c.title}</h1>
              {d.c.reason && <p className="text-ink-secondary">{d.c.reason}</p>}
              <p className="text-sm text-ink-secondary">Ingen e-post sendes automatisk. Avtaleprisen endres ikke av saken.</p>
            </header>
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-xl border border-line-subtle bg-card p-5 space-y-3">
                <h2 className="font-semibold">Fakturaer i saken · {kr(total)} ekskl. mva.</h2>
                <ul className="divide-y divide-line-subtle text-sm">
                  {invoices.map(([invId, no]) => (
                    <li key={invId} className="flex justify-between gap-3 py-2">
                      <Link className="text-primary hover:underline" to={`/ravarer/fakturaer/${invId}`}>{no}</Link>
                      <span>Restavvik {kr(remaining.get(invId) ?? 0)} ekskl. mva.</span>
                    </li>
                  ))}
                </ul>
                <h3 className="pt-2 font-medium">Kreditfordeling</h3>
                {d.credits.length === 0 ? <p className="text-sm text-ink-secondary">Ingen kreditt fordelt ennå.</p> : (
                  <ul className="divide-y divide-line-subtle text-sm">
                    {d.credits.map((c) => (
                      <li key={c.id} className="flex justify-between gap-3 py-2">
                        <span>Kreditnota {c.credit?.invoice_number} → {invoices.find(([i]) => i === c.invoice_id)?.[1]}</span>
                        <span>{kr(c.amount_excl_vat)} ekskl. mva.</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="rounded-xl border border-line-subtle bg-card p-5 space-y-4">
                {d.c.status === "open" && (
                  <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); alloc.mutate(); }}>
                    <h2 className="font-semibold">Fordel kreditnota</h2>
                    <div className="space-y-1">
                      <Label htmlFor="credit-note">Kreditnota fra {d.c.supplier?.name}</Label>
                      <select id="credit-note" className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={noteId} onChange={(e) => setNoteId(e.target.value)}>
                        <option value="">Velg kreditnota</option>
                        {d.notes.map((n) => <option key={n.id} value={n.id}>{n.invoice_number} · ufordelt {kr(unallocated(n.id))} ekskl. mva.</option>)}
                      </select>
                      {d.notes.length === 0 && <p className="text-sm text-ink-secondary">Ingen kreditnotaer fra denne leverandøren er importert.</p>}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="credit-invoice">Gjelder faktura</Label>
                      <select id="credit-invoice" className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
                        <option value="">Velg faktura</option>
                        {invoices.map(([i, no]) => <option key={i} value={i}>{no} · restavvik {kr(remaining.get(i) ?? 0)}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="credit-amount">Beløp ekskl. mva.</Label>
                      <Input id="credit-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                      {noteId && invoiceId && <p className="text-sm text-ink-secondary">Maks {kr(max)} for denne fakturaen.</p>}
                    </div>
                    <Button type="submit" disabled={alloc.isPending || !noteId || !invoiceId || parsed == null || parsed <= 0 || parsed > max + 0.005}>
                      {alloc.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Fordel kreditten
                    </Button>
                    <p className="text-sm text-ink-secondary">Kreditten reduserer bare valgt fakturas restavvik. Fakturaen godkjennes ikke automatisk.</p>
                  </form>
                )}
                <div className="space-y-2 border-t border-line-subtle pt-3">
                  <Label htmlFor="case-note">Begrunnelse for statusendring</Label>
                  <Textarea id="case-note" value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    {d.c.status === "open" ? (
                      <>
                        <Button variant="outline" disabled={status.isPending} onClick={() => status.mutate("resolved")}>Merk som løst</Button>
                        <Button variant="ghost" disabled={status.isPending} onClick={() => status.mutate("cancelled")}>Avbryt saken</Button>
                      </>
                    ) : (
                      <Button variant="outline" disabled={status.isPending} onClick={() => status.mutate("open")}>Åpne saken igjen</Button>
                    )}
                  </div>
                  {d.c.resolution_note && <p className="text-sm text-ink-secondary">Siste begrunnelse: {d.c.resolution_note}</p>}
                </div>
              </section>
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}
