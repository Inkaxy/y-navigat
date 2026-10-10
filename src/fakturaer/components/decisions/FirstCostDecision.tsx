import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DecisionGroup } from "@/fakturaer/lib/decisionGroups";
import { postSafeCosts } from "@/fakturaer/lib/costPosting";
import { applyPackageToLines, outcomeNotes } from "@/fakturaer/lib/groupActions";
import { formatMoney } from "@/fakturaer/lib/constants";
import { paths } from "@/ravarer/lib/paths";

const sourceLabel = (s: string | null) => (s === "tripletex" ? "Tripletex (tolket fra PDF)" : s === "ehf" ? "EHF" : s === "pdf" ? "PDF-import" : s ?? "ukjent kilde");

type Line = DecisionGroup["lines"][number];

/** Mengde × fakturapris går ikke opp mot linjesum, eller grunnmengden mangler: pakningen må bekreftes. */
export function needsPackage(l: Line): boolean {
  if (l.base_quantity == null || !(Number(l.base_quantity) > 0)) return true;
  const q = l.quantity == null ? null : Number(l.quantity);
  const p = l.unit_price == null ? null : Number(l.unit_price);
  const t = l.total_amount == null ? null : Number(l.total_amount);
  if (q == null || p == null || t == null || !Number.isFinite(q * p) || !Number.isFinite(t)) return true;
  return Math.abs(q * p - t) > Math.max(1, Math.abs(t) * 0.01);
}

const nf = (n: number) => n.toLocaleString("nb-NO", { maximumFractionDigits: 3 });

/** Første kostpris: hver linje vises med egen kilde, dato og pris. Ingen representativ pris. */
export function FirstCostDecision({ g, canWrite, onSaved }: { g: DecisionGroup; canWrite: boolean; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const unit = g.lines[0].matched_raw_material?.base_unit ?? "grunnenhet";
  const lines = [...g.lines].sort((a, b) => (a.invoice.invoice_date ?? "").localeCompare(b.invoice.invoice_date ?? ""));
  const missing = lines.filter(needsPackage);
  const sample = missing[0] ?? lines[0];
  const guess = sample.package_unit && sample.package_unit.toLowerCase() === unit.toLowerCase() && sample.package_size ? String(sample.package_size) : "";
  const [content, setContent] = useState(guess);
  const contentNum = Number(content.replace(",", "."));
  const contentOk = Number.isFinite(contentNum) && contentNum > 0;
  const packWord = sample.unit ?? "pakning";

  async function post() {
    setBusy(true);
    try {
      if (missing.length) {
        if (!contentOk) { toast.error(`Fyll inn hvor mange ${unit} det er i 1 ${packWord}`); return; }
        const r = await applyPackageToLines(missing, contentNum);
        if (r.failed) toast.error(`Pakning: ${r.text}`, { description: r.outcomes.filter((o) => !o.ok).map((o) => `${o.invoiceNumber}: ${o.message}`).join("\n") });
        outcomeNotes(r).forEach((n) => toast.message(n));
        if (r.ok === 0) return;
      }
      const res = await postSafeCosts(g.invoiceIds, g.lines.map((l) => l.id));
      const posted = res.reduce((s, r) => s + r.posted, 0);
      const failed = res.filter((r) => r.error);
      const skipped = res.reduce((s, r) => s + r.skipped, 0);
      if (posted === 0 && skipped === 0 && failed.length === 0) {
        toast.success("Disse linjene er allerede ført som første kostpris");
        await onSaved();
        return;
      }
      (posted === g.lines.length ? toast.success : toast.error)(
        `Første kostpris: ${posted} av ${g.lines.length} linjer ført`,
        failed.length ? { description: failed.map((f) => f.error).join("\n") }
          : skipped ? { description: `${skipped} linjer stoppet fordi mengde × pris ikke går opp mot linjesummen. Kontroller pakningen.` } : undefined,
      );
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  const ex = missing[0];
  const exQ = ex?.quantity != null ? Number(ex.quantity) : null;
  const exT = ex?.total_amount != null ? Number(ex.total_amount) : null;

  return (
    <div className="space-y-4">
      <p className="text-body">
        Ingen avtale- eller startpris finnes for <strong>{g.lines[0].matched_raw_material?.name ?? g.description}</strong>. Hver linje føres med sin egen dokumenterte pris og dato.
      </p>

      {missing.length > 0 && (
        <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <p className="font-medium">Mangler: hvor mye er det i 1 {packWord}?</p>
          <p className="text-sm">
            {missing.length} av {lines.length} linjer kan ikke føres ennå. Fakturaen viser for eksempel «{exQ ?? "?"} {packWord} × {ex?.unit_price ?? "?"} kr = {exT != null ? formatMoney(exT, ex?.invoice.currency ?? "NOK") : "?"}», som ikke går opp uten pakningsinnholdet.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="fc-content">{unit} per {packWord}</Label>
              <Input id="fc-content" inputMode="decimal" className="w-32" value={content} onChange={(e) => setContent(e.target.value)} disabled={!canWrite} />
            </div>
            {contentOk && exQ != null && exT != null && (
              <p className="text-sm tabular-nums">
                {nf(exQ)} × {nf(contentNum)} {unit} = {nf(exQ * contentNum)} {unit} · {formatMoney(exT / (exQ * contentNum), ex.invoice.currency ?? "NOK")} per {unit}
              </p>
            )}
          </div>
          <p className="text-sm text-ink-secondary">Pakningen huskes for varenummeret og brukes ved neste import.</p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-secondary">
            <tr><th className="py-1 pr-3 font-normal">Faktura</th><th className="py-1 pr-3 font-normal">Dato</th><th className="py-1 pr-3 font-normal">Kilde</th><th className="py-1 text-right font-normal">Pris per {unit}</th></tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {lines.map((l) => {
              const q = l.quantity != null ? Number(l.quantity) : null;
              const t = l.total_amount != null ? Number(l.total_amount) : null;
              const price = needsPackage(l)
                ? (contentOk && q && t != null ? t / (q * contentNum) : null)
                : l.price_per_base_unit;
              return (
                <tr key={l.id}>
                  <td className="py-2 pr-3"><Link className="text-primary hover:underline" to={paths.fakturaInnboks({ faktura: l.invoice_id })}>{l.invoice.invoice_number}</Link></td>
                  <td className="py-2 pr-3 tabular-nums">{l.invoice.invoice_date ?? "Uten dato"}</td>
                  <td className="py-2 pr-3">{sourceLabel(l.invoice.source)}</td>
                  <td className="py-2 text-right tabular-nums">{price != null ? formatMoney(price, l.invoice.currency ?? "NOK") : "Mangler pakning"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-ink-secondary">Ulike datoer og priser beholdes hver for seg i prishistorikken. Avtalepris opprettes ikke, og fakturaene godkjennes ikke.</p>
      {canWrite ? (
        <Button className="w-full sm:w-auto" disabled={busy || (missing.length > 0 && !contentOk)} onClick={post}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {missing.length > 0
            ? `Lagre ${contentOk ? nf(contentNum) : "…"} ${unit} per ${packWord} og før ${lines.length} linjer`
            : g.lines.length > 1 ? `Før ${g.lines.length} linjer som første kostpris` : "Før som første kostpris"}
        </Button>
      ) : (
        <p className="text-sm text-ink-secondary">Du har lesetilgang og kan ikke føre kostpris.</p>
      )}
    </div>
  );
}
