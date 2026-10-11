import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { PriceDeviationNote } from "@/fakturaer/components/PriceDeviationNote";
import type { MatchSettings } from "@/fakturaer/hooks/useMatchTolerances";
import { formatDate } from "@/fakturaer/lib/constants";
import { PRICE_REFERENCE_LABEL } from "@/ravarer/lib/labels";
import { kr, ppbu, priceChange, pricePrimaryAction, showPackageHint, signedKr, signedPct, type PriceLine } from "./logic";

export type PriceRow = PriceLine & { invoice_id: string; invoice_number: string | null; invoice_date: string | null; quantity: number | null; unit: string | null };

export type PriceBlockViewProps = {
  rows: PriceRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  baseUnit: string | null;
  referenceSource: string | null;
  referenceDate: string | null;
  hasAgreement: boolean;
  tolerancePct: number;
  hardCapPct: number;
  settings: MatchSettings | null;
  reason: string;
  onReason: (v: string) => void;
  canWrite: boolean;
  busy: boolean;
  error?: string | null;
  onAccept: () => void;
  onClaim: () => void;
  onFixAgreement: () => void;
  onCheckPackage: () => void;
  startPrice?: { onConfirm: () => void } | null;
};

const refLabel = (s: string | null) => (s && s in PRICE_REFERENCE_LABEL ? PRICE_REFERENCE_LABEL[s as keyof typeof PRICE_REFERENCE_LABEL] : "Prisgrunnlag");

/** Pris-blokken i varekortet: sammenligning, linjer med avkrysning og én primærhandling etter situasjon. */
export function PriceBlockView(p: PriceBlockViewProps) {
  const chosen = p.rows.filter((r) => p.selected.has(r.id));
  const ch = priceChange(chosen);
  const primary = pricePrimaryAction({ pct: ch?.pct ?? null, hardCapPct: p.hardCapPct, hasAgreement: p.hasAgreement });
  const unit = p.baseUnit ?? "enhet";
  const disabled = !p.canWrite || p.busy || chosen.length === 0;
  const qty = chosen.reduce((s, r) => s + (r.base_quantity ?? 0), 0);

  return (
    <div className="space-y-3">
      {ch ? (
        <div className="grid gap-2 rounded-md border border-line-subtle p-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-caption text-ink-secondary">Forventet</p>
            <p className="tabular-nums">{ppbu(ch.expected)} kr/{unit}</p>
            <p className="text-caption text-ink-secondary">{refLabel(p.referenceSource)}{p.referenceDate ? ` · ${formatDate(p.referenceDate)}` : ""}</p>
          </div>
          <div>
            <p className="text-caption text-ink-secondary">Fakturert</p>
            <p className="font-medium tabular-nums">{ppbu(ch.actual)} kr/{unit}</p>
          </div>
          <div>
            <p className="text-caption text-ink-secondary">Endring</p>
            <p className={ch.pct > 0 ? "font-medium tabular-nums text-warning" : "font-medium tabular-nums text-success"}>{signedPct(ch.pct)} · {signedKr(ch.impactNok)}</p>
            <p className="text-caption text-ink-secondary">for {chosen.length} {chosen.length === 1 ? "linje" : "linjer"}</p>
          </div>
          <PriceDeviationNote className="sm:col-span-3" actual={ch.actual} expected={ch.expected} baseQuantity={qty || null} tolerancePct={p.tolerancePct} settings={p.settings} />
        </div>
      ) : (
        <p className="text-sm text-ink-secondary">Velg minst én linje for å se sammenligningen.</p>
      )}

      {showPackageHint(ch?.pct ?? null) && (
        <p className="flex items-start gap-1.5 text-caption text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Store prisavvik skyldes ofte feil pakning.</p>
      )}

      <div className="overflow-x-auto rounded-md border border-line-subtle">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-caption text-ink-secondary">
            <tr><th className="w-8 px-2 py-1.5"><span className="sr-only">Velg</span></th><th className="px-2 py-1.5">Faktura</th><th className="px-2 py-1.5">Dato</th><th className="px-2 py-1.5 text-right">Mengde</th><th className="px-2 py-1.5 text-right">Pris/{unit}</th><th className="px-2 py-1.5 text-right">Avvik</th></tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {p.rows.map((r) => {
              const diff = (r.price_per_base_unit - r.expected_price_per_base_unit) * (r.base_quantity ?? 0);
              return (
                <tr key={r.id}>
                  <td className="px-2 py-1.5"><Checkbox aria-label={`Velg linje på faktura ${r.invoice_number ?? ""}`} checked={p.selected.has(r.id)} onCheckedChange={() => p.onToggle(r.id)} /></td>
                  <td className="px-2 py-1.5">{r.invoice_number ?? "—"}</td>
                  <td className="px-2 py-1.5 text-ink-secondary">{formatDate(r.invoice_date)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.quantity != null ? `${r.quantity.toLocaleString("nb-NO")} ${r.unit ?? ""}` : "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{ppbu(r.price_per_base_unit)}</td>
                  <td className={diff > 0 ? "px-2 py-1.5 text-right tabular-nums text-warning" : "px-2 py-1.5 text-right tabular-nums"}>{signedKr(diff)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Textarea value={p.reason} onChange={(e) => p.onReason(e.target.value)} placeholder="Begrunnelse (valgfri)" rows={2} aria-label="Begrunnelse" />
      {p.error && <p role="alert" className="text-sm text-destructive">{p.error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button data-action="accept-price" data-primary-action={primary === "accept" ? "" : undefined} variant={primary === "accept" ? "default" : "outline"} disabled={disabled} onClick={p.onAccept}>Godta ny pris</Button>
        <Button data-action="claim-credit" data-primary-action={primary === "claim" ? "" : undefined} variant={primary === "claim" ? "default" : "outline"} disabled={disabled || !ch || ch.pct <= 0} onClick={p.onClaim}>
          Krev kreditt fra leverandøren{ch && ch.impactNok > 0 ? ` (${kr(ch.impactNok)})` : ""}
        </Button>
        <Button variant="ghost" disabled={!p.canWrite} onClick={p.onFixAgreement}>Rett avtalepris</Button>
        <Button data-action="check-package" variant="ghost" onClick={p.onCheckPackage}>Kontroller pakningen</Button>
        {p.startPrice && <Button variant="ghost" disabled={!p.canWrite} onClick={p.startPrice.onConfirm}>Bekreft startpris</Button>}
      </div>
      {!p.canWrite && <p className="text-caption text-ink-secondary">Du har bare lesetilgang.</p>}
    </div>
  );
}
