import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { PriceDeviationNote } from "@/fakturaer/components/PriceDeviationNote";
import { DEFAULT_HARD_CAP_PCT, DEFAULT_MIN_IMPACT_NOK } from "@/fakturaer/hooks/useMatchTolerances";
import { evaluatePriceDeviation } from "@/fakturaer/lib/priceDeviation";
import type { MatchSettings } from "@/fakturaer/hooks/useMatchTolerances";
import { formatDate } from "@/fakturaer/lib/constants";
import { PRICE_REFERENCE_LABEL } from "@/ravarer/lib/labels";
import { paths } from "@/ravarer/lib/paths";
import { kr, perLineDeviation, ppbu, priceChange, pricePrimaryAction, showPackageHint, signedPct, type PriceLine } from "./logic";

/** Linje med SERVERKONTROLLERT pris, forventet pris, mengde og absolutt prisavvik (`effect_nok`). */
export type PriceRow = PriceLine & { invoice_id: string; invoice_number: string | null; invoice_date: string | null; quantity: number | null; unit: string | null; effect_nok: number; reference_source: string | null; reference_id: string | null;
  /** Fra serverens kvittering (schema 2). */
  raw_material_id: string; base_unit: string; reference_date: string | null };
/** Linje som ikke kan sammenlignes nå, med serverens årsak. */
export type BlockedRow = { id: string; invoice_id: string; invoice_number: string | null; invoice_date: string | null; label: string; detail: string };

export type PriceBlockViewProps = {
  rows: PriceRow[];
  blocked: BlockedRow[];
  /** Prisstatus hentes, har feilet eller er utdatert. */
  status: "ready" | "loading" | "error";
  onRetry?: () => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  hasAgreement: boolean;
  tolerancePct: number;
  hardCapPct: number;
  settings: MatchSettings | null;
  reason: string;
  onReason: (v: string) => void;
  canWrite: boolean;
  busy: boolean;
  error?: string | null;
  errorReasons?: string[];
  onAccept: () => void;
  onCase: () => void;
  onFixAgreement: () => void;
  onCheckPackage: () => void;
  startPrice?: { onConfirm: () => void } | null;
};

const refLabel = (s: string | null) => (s && s in PRICE_REFERENCE_LABEL ? PRICE_REFERENCE_LABEL[s as keyof typeof PRICE_REFERENCE_LABEL] : "Prisgrunnlag");

/** Pris-blokken i varekortet. Bare serverkontrollerte linjer kan sammenlignes, velges og summeres. */
export function PriceBlockView(p: PriceBlockViewProps) {
  const chosen = p.rows.filter((r) => p.selected.has(r.id));
  // Aldri snitt på tvers av råvare eller enhet (kg og l summeres ikke).
  const groups = new Set(chosen.map((r) => `${r.raw_material_id}|${r.base_unit}`));
  const mixed = groups.size > 1;
  const ch = mixed ? null : priceChange(chosen);
  const positiveCount = ch?.positiveIds.length ?? 0;
  const primary = pricePrimaryAction({ pct: positiveCount ? Math.max(ch?.pct ?? 0, 0.0001) : null, hardCapPct: p.hardCapPct, hasAgreement: p.hasAgreement });
  const unit = (chosen[0] ?? p.rows[0])?.base_unit ?? "enhet";
  const disabled = !p.canWrite || p.busy || chosen.length === 0 || p.status !== "ready";
  // Én felles referanse bare når alle valgte linjer peker på samme grunnlag.
  const refKeys = [...new Set(chosen.map((r) => `${r.reference_source}|${r.reference_id}`))];
  const oneRef = refKeys.length === 1 ? chosen[0] : null;

  return (
    <div className="space-y-3">
      {p.status === "loading" && <p role="status" className="text-sm text-ink-secondary">Prisgrunnlag ikke kontrollert ennå — henter status fra serveren …</p>}
      {p.status === "error" && (
        <p role="alert" className="text-sm text-warning">Prisgrunnlaget kunne ikke kontrolleres. Ingen prisavvik vises. {p.onRetry && <button type="button" className="underline" onClick={p.onRetry}>Prøv igjen</button>}</p>
      )}
      {p.status === "ready" && (ch ? (
        <div className="space-y-2 rounded-md border border-line-subtle p-3 text-sm">
          <p className="text-caption text-ink-secondary">Mengdevektet snitt for {chosen.length} valgte {chosen.length === 1 ? "linje" : "linjer"} · {oneRef ? `${refLabel(oneRef.reference_source)}${oneRef.reference_date ? ` · ${formatDate(oneRef.reference_date)}` : ""}` : "Ulike sammenligningsgrunnlag — se linjene"}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div><p className="text-caption text-ink-secondary">Forventet (snitt)</p><p className="tabular-nums">{ppbu(ch.expected)} kr/{unit}</p></div>
            <div><p className="text-caption text-ink-secondary">Fakturert (snitt, kontrollert)</p><p className="font-medium tabular-nums">{ppbu(ch.actual)} kr/{unit} <span className="text-ink-secondary">({signedPct(ch.pct)})</span></p></div>
          </div>
          <dl className="grid gap-1 sm:grid-cols-3">
            <div><dt className="text-caption text-ink-secondary">Netto prisendring</dt><dd className="tabular-nums">{ch.impactNok > 0 ? "+" : ""}{kr(ch.impactNok)}</dd></div>
            <div><dt className="text-caption text-ink-secondary">Samlet avvik til gjennomgang</dt><dd className="tabular-nums">{kr(ch.absoluteNok)}</dd></div>
            <div><dt className="text-caption text-ink-secondary">Dyrere linjer (mulig sak)</dt><dd className={positiveCount ? "tabular-nums text-warning" : "tabular-nums"}>{positiveCount ? `${kr(ch.positiveNok)} · ${positiveCount} ${positiveCount === 1 ? "linje" : "linjer"}` : "Ingen"}</dd></div>
          </dl>
          <p className="text-caption text-ink-secondary">Snittet er ikke en ny enhetspris. Lavere pris på én faktura motregner ikke en dyrere linje.</p>
          {chosen.length === 1 ? (
            <PriceDeviationNote actual={chosen[0].price_per_base_unit} expected={chosen[0].expected_price_per_base_unit} baseQuantity={chosen[0].base_quantity} tolerancePct={p.tolerancePct} settings={p.settings} />
          ) : (() => {
            const d = perLineDeviation(chosen, (l) => evaluatePriceDeviation({ actual: l.price_per_base_unit, expected: l.expected_price_per_base_unit, baseQuantity: l.base_quantity, tolPct: p.tolerancePct, minImpactNok: p.settings?.price_min_impact_nok ?? DEFAULT_MIN_IMPACT_NOK, hardCapPct: p.settings?.price_hard_cap_pct ?? DEFAULT_HARD_CAP_PCT }));
            return <p data-testid="per-line-deviation" className={d.large ? "text-caption text-warning" : "text-caption text-ink-secondary"}>Vurdert per linje: {d.large} med stort avvik, {d.within} innenfor toleranse{d.unknown ? `, ${d.unknown} uten grunnlag` : ""}. Snittet vurderes ikke mot toleransen.</p>;
          })()}
        </div>
      ) : mixed ? (
        <p className="text-sm text-warning">Valgte linjer har ulik råvare eller grunnenhet — sammendrag vises ikke. Velg linjer med samme enhet.</p>
      ) : chosen.length > 0 ? (
        <p className="text-sm text-warning">Mengde mangler eller er ugyldig på en valgt linje — sammendrag vises ikke.</p>
      ) : p.rows.length > 0 ? (
        <p className="text-sm text-ink-secondary">Velg linjene du vil vurdere. Ingen er valgt på forhånd.</p>
      ) : null)}

      {showPackageHint(ch?.pct ?? null) && (
        <p className="flex items-start gap-1.5 text-caption text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Store prisavvik skyldes ofte feil pakning.</p>
      )}

      {p.status === "ready" && p.rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line-subtle">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-caption text-ink-secondary">
              <tr><th className="w-8 px-2 py-1.5"><span className="sr-only">Velg</span></th><th className="px-2 py-1.5">Faktura</th><th className="px-2 py-1.5">Dato</th><th className="px-2 py-1.5 text-right">Pris / forventet</th><th className="px-2 py-1.5">Grunnlag</th><th className="px-2 py-1.5 text-right">Endring</th></tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {p.rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-0 py-0"><label className="flex h-11 w-11 cursor-pointer items-center justify-center"><Checkbox aria-label={`Velg linje på faktura ${r.invoice_number ?? ""}`} checked={p.selected.has(r.id)} onCheckedChange={() => p.onToggle(r.id)} /></label></td>
                  <td className="px-2 py-1.5"><Link className="underline-offset-2 hover:underline" to={paths.faktura(r.invoice_id)}>{r.invoice_number ?? "—"}</Link></td>
                  <td className="px-2 py-1.5 text-ink-secondary">{formatDate(r.invoice_date)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{ppbu(r.price_per_base_unit)} <span className="text-ink-secondary">/ {ppbu(r.expected_price_per_base_unit)} kr/{r.base_unit}</span></td>
                  <td className="px-2 py-1.5 text-caption text-ink-secondary">{refLabel(r.reference_source)}{r.reference_date ? ` · ${formatDate(r.reference_date)}` : ""}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.price_per_base_unit > r.expected_price_per_base_unit ? "+" : "−"}{kr(r.effect_nok)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {p.blocked.length > 0 && (
        <div className="space-y-1 rounded-md border border-border p-3 text-sm">
          <p className="font-medium">{p.blocked.length} {p.blocked.length === 1 ? "linje kan" : "linjer kan"} ikke sammenlignes nå</p>
          <ul className="space-y-1 text-caption">
            {p.blocked.map((b) => (
              <li key={b.id} className="flex flex-wrap gap-x-2">
                <Link className="underline underline-offset-2" to={paths.faktura(b.invoice_id)}>Faktura {b.invoice_number ?? "—"}</Link>
                <span className="text-ink-secondary">{formatDate(b.invoice_date)}</span>
                <span className="text-warning" title={b.detail}>{b.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Textarea value={p.reason} onChange={(e) => p.onReason(e.target.value)} placeholder="Begrunnelse (valgfri)" rows={2} aria-label="Begrunnelse" />
      {p.error && (
        <div role="alert" className="text-sm text-destructive">
          <p>{p.error}</p>
          {p.errorReasons && p.errorReasons.length > 0 && <ul className="list-disc pl-5">{p.errorReasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        </div>
      )}

      <div className="flex flex-wrap gap-2 [&>button]:min-h-11">
        <Button data-action="accept-price" data-primary-action={primary === "accept" ? "" : undefined} variant={primary === "accept" ? "default" : "outline"} disabled={disabled} onClick={p.onAccept}>Godta ny pris</Button>
        <Button data-action="claim-credit" data-primary-action={primary === "claim" ? "" : undefined} variant={primary === "claim" ? "default" : "outline"} disabled={disabled || positiveCount === 0} onClick={p.onCase}>
          {positiveCount ? `Opprett leverandørsak for ${positiveCount} dyrere ${positiveCount === 1 ? "linje" : "linjer"} …` : "Opprett leverandørsak …"}
        </Button>
        <Button variant="ghost" disabled={!p.canWrite} onClick={p.onFixAgreement}>Rett avtalepris</Button>
        <Button data-action="check-package" variant="ghost" onClick={p.onCheckPackage}>Kontroller pakningen</Button>
        {p.startPrice && <Button variant="ghost" disabled={!p.canWrite} onClick={p.startPrice.onConfirm}>Bekreft startpris</Button>}
      </div>
      <p className="text-caption text-ink-secondary">Serveren avgjør om saken blir et dokumentert krav (avtalepris) eller en prisforespørsel (tidligere kjøp eller startpris).</p>
      {!p.canWrite && <p className="text-caption text-ink-secondary">Du har bare lesetilgang.</p>}
    </div>
  );
}
