import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { DecisionGroup } from "@/fakturaer/lib/decisionGroups";
import { postSafeCosts } from "@/fakturaer/lib/costPosting";
import { formatMoney } from "@/fakturaer/lib/constants";

const sourceLabel = (s: string | null) => (s === "tripletex" ? "Tripletex (tolket fra PDF)" : s === "ehf" ? "EHF" : s === "pdf" ? "PDF-import" : s ?? "ukjent kilde");

/** Første kostpris: hver linje vises med egen kilde, dato og pris. Ingen representativ pris. */
export function FirstCostDecision({ g, canWrite, onSaved }: { g: DecisionGroup; canWrite: boolean; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const unit = g.lines[0].matched_raw_material?.base_unit ?? "grunnenhet";
  const lines = [...g.lines].sort((a, b) => (a.invoice.invoice_date ?? "").localeCompare(b.invoice.invoice_date ?? ""));

  async function post() {
    setBusy(true);
    try {
      const res = await postSafeCosts(g.invoiceIds, g.lines.map((l) => l.id));
      const posted = res.reduce((s, r) => s + r.posted, 0);
      const failed = res.filter((r) => r.error);
      (posted === g.lines.length ? toast.success : toast.error)(`Første kostpris: ${posted} av ${g.lines.length} linjer ført`, failed.length ? { description: failed.map((f) => f.error).join("\n") } : undefined);
      if (posted > 0) await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-body">
        Ingen avtale- eller startpris finnes for <strong>{g.lines[0].matched_raw_material?.name ?? g.description}</strong>. Hver linje føres med sin egen dokumenterte pris og dato.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-secondary">
            <tr><th className="py-1 pr-3 font-normal">Faktura</th><th className="py-1 pr-3 font-normal">Dato</th><th className="py-1 pr-3 font-normal">Kilde</th><th className="py-1 text-right font-normal">Pris per {unit}</th></tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="py-2 pr-3"><Link className="text-primary hover:underline" to={`/ravarer/fakturaer/til-behandling?faktura=${l.invoice_id}`}>{l.invoice.invoice_number}</Link></td>
                <td className="py-2 pr-3 tabular-nums">{l.invoice.invoice_date ?? "Uten dato"}</td>
                <td className="py-2 pr-3">{sourceLabel(l.invoice.source)}</td>
                <td className="py-2 text-right tabular-nums">{l.price_per_base_unit != null ? formatMoney(l.price_per_base_unit, l.invoice.currency ?? "NOK") : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-ink-secondary">Ulike datoer og priser beholdes hver for seg i prishistorikken. Avtalepris opprettes ikke, og fakturaene godkjennes ikke.</p>
      {canWrite ? (
        <Button className="w-full sm:w-auto" disabled={busy} onClick={post}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {g.lines.length > 1 ? `Før ${g.lines.length} linjer som første kostpris` : "Før som første kostpris"}
        </Button>
      ) : (
        <p className="text-sm text-ink-secondary">Du har lesetilgang og kan ikke føre kostpris.</p>
      )}
    </div>
  );
}
