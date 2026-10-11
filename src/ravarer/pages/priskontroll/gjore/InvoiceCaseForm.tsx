import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { invalidateInvoice, invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import { paths } from "@/ravarer/lib/paths";
import { claimErrorMessage, kr } from "./logic";
import type { PanelResult } from "./types";

export type CaseLine = {
  id: string; description: string | null; price_per_base_unit: number | null;
  expected_price_per_base_unit: number | null; base_quantity: number | null;
};

/** Merkostnad per linje — samme regel som `create_supplier_deviation_case` (bare dyrere linjer med kjent mengde). */
export function caseLineAmount(l: CaseLine): number | null {
  const a = l.price_per_base_unit, e = l.expected_price_per_base_unit, q = l.base_quantity;
  if (a == null || e == null || q == null || q <= 0 || !Number.isFinite(a) || !Number.isFinite(e)) return null;
  const d = Math.round((a - e) * q * 100) / 100;
  return d > 0 ? d : null;
}

type Props = { invoiceId: string; invoiceNumber: string | null; lines: CaseLine[]; canWrite: boolean; onDone: (r: PanelResult) => void; onCancel: () => void };

/** «Opprett leverandørsak» direkte fra en flagget faktura: velg linjer med merkostnad. */
export function InvoiceCaseForm({ invoiceId, invoiceNumber, lines, canWrite, onDone, onCancel }: Props) {
  const qc = useQueryClient();
  const candidates = useMemo(() => lines.flatMap((l) => { const a = caseLineAmount(l); return a != null ? [{ ...l, amount: a }] : []; }), [lines]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates.map((c) => c.id)));
  const [title, setTitle] = useState(`Avvik faktura ${invoiceNumber ?? ""}`.trim());
  const [reason, setReason] = useState("");
  const [follow, setFollow] = useState("");
  const total = candidates.filter((c) => picked.has(c.id)).reduce((s, c) => s + c.amount, 0);

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("create_supplier_deviation_case", {
        p_line_ids: [...picked], p_title: title.trim(), p_reason: reason.trim() || undefined, p_follow_up_on: follow || undefined,
      });
      if (error) { console.error("[invoice-case]", error); throw new Error(claimErrorMessage(error.message)); }
      const caseId = typeof data === "object" && data !== null && !Array.isArray(data) && typeof data.case_id === "string" ? data.case_id : null;
      return caseId;
    },
    onSuccess: (caseId) => {
      invalidateInvoice(qc, invoiceId);
      invalidateRavarerCounts(qc);
      void qc.invalidateQueries({ queryKey: ["supplier-cases"] });
      onDone({ title: `Leverandørsak opprettet (${kr(total)})`, items: [`${picked.size} ${picked.size === 1 ? "linje" : "linjer"} med i saken`], link: caseId ? { to: paths.sak(caseId), label: "Åpne leverandørsaken" } : undefined });
    },
  });

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-3 rounded-md border border-line-subtle p-3 text-sm">
      <p className="font-medium">Opprett leverandørsak</p>
      {candidates.length === 0 ? (
        <p className="text-ink-secondary">Ingen linjer på fakturaen er dyrere enn forventet med kjent mengde — det er ingen merkostnad å kreve.</p>
      ) : (
        <ul className="divide-y divide-line-subtle rounded-md border border-line-subtle">
          {candidates.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-2 py-1.5">
              <Checkbox aria-label={`Ta med ${c.description ?? "linje"}`} checked={picked.has(c.id)} onCheckedChange={() => toggle(c.id)} />
              <span className="min-w-0 flex-1 truncate">{c.description ?? "Linje"}</span>
              <span className="tabular-nums text-warning">+{kr(c.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-1"><Label htmlFor="case-title">Tittel</Label><Input id="case-title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="case-reason">Begrunnelse</Label><Textarea id="case-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="case-follow">Oppfølgingsdato (valgfri)</Label><Input id="case-follow" type="date" value={follow} onChange={(e) => setFollow(e.target.value)} /></div>
      {create.isError && <p role="alert" className="text-destructive">{create.error.message}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!canWrite || create.isPending || picked.size === 0 || !title.trim()} onClick={() => create.mutate()}>
          {create.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}Opprett sak ({kr(total)})
        </Button>
        <Button variant="ghost" onClick={onCancel}>Avbryt</Button>
      </div>
    </div>
  );
}
