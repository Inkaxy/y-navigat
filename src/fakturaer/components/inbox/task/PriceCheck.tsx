import { useState } from "react";
import { formatDate, formatMoney } from "@/fakturaer/lib/constants";
import { PriceDeviationNote } from "@/fakturaer/components/PriceDeviationNote";
import { useMatchTolerances } from "@/fakturaer/hooks/useMatchTolerances";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { SupplierLinkRow } from "@/fakturaer/hooks/useSupplierLinkContext";
import { baseUnitOf, reasonsIn } from "@/fakturaer/lib/lineControl";
import { usePriceGate } from "@/fakturaer/lib/priceGateContext";

/** Etikett fra serverens kvittering — aldri fra en eldre linjekopi. */
function referenceLabel(source: string | null, date: string | null): string | null {
  const d = date ? ` ${formatDate(date)}` : "";
  switch (source) {
    case "agreement":
      return `avtalepris${d}`;
    case "last_purchase":
      return `forrige kjøp${d}`;
    case "start_price":
      return `startpris${d}`;
    case "conflict":
      return "to likestilte avtaler";
    default:
      return null;
  }
}

/** Fakturapris per grunnenhet mot riktig sammenligningspris. Resten under «Prisdetaljer». */
export function PriceCheck({ line, link, tolerancePct }: { line: ReviewLineRow; link: SupplierLinkRow | null; tolerancePct: number }) {
  const [open, setOpen] = useState(false);
  const { settings } = useMatchTolerances(line.invoice.legal_entity_id);
  const currency = line.invoice.currency ?? "NOK";
  const reasons = reasonsIn(line, "price");
  const gate = usePriceGate(line);
  // Sammenligningsenhet og referanse kommer fra kvitteringen; dokumentets egne tall vises separat.
  const unit = (gate.ok ? gate.safety.base_unit : null) ?? baseUnitOf(line, link) ?? "grunnenhet";
  const ref = gate.ok ? referenceLabel(gate.safety.reference_source, gate.safety.reference_date) : null;
  const credit = line.invoice.is_credit_note === true || (!gate.ok && gate.action === "review_credit_note");

  return (
    <div className="space-y-2 text-sm">
      {gate.ok ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-caption text-ink-secondary">Kontrollert pris</div>
              <div className="text-base font-semibold tabular-nums">{gate.safety.price_per_base_unit == null ? "—" : `${formatMoney(gate.safety.price_per_base_unit, "NOK")} / ${unit}`}</div>
            </div>
            <div>
              <div className="text-caption text-ink-secondary">Sammenlignes med{ref ? ` ${ref}` : ""}</div>
              <div className="text-base font-semibold tabular-nums">{gate.safety.expected_price_per_base_unit == null ? "—" : `${formatMoney(gate.safety.expected_price_per_base_unit, "NOK")} / ${unit}`}</div>
            </div>
          </div>
          <PriceDeviationNote actual={gate.safety.price_per_base_unit} expected={gate.safety.expected_price_per_base_unit} baseQuantity={gate.safety.base_quantity} tolerancePct={tolerancePct} settings={settings} />
        </>
      ) : (
        <div role="note" className="rounded-md border border-warning/30 bg-warning/10 p-2 text-caption">
          <p className="font-medium text-warning">{credit ? "Kreditnota – ikke en prisendring" : gate.label}</p>
          <p className="text-ink-secondary">{credit ? "Beløpene vises som på dokumentet. Koble kreditnotaen til opprinnelig faktura." : gate.detail}</p>
          <p className="mt-1 text-ink-secondary">Lagret lesing (må kontrolleres mot originalen): {line.quantity ?? "—"} {line.unit ?? ""} × {formatMoney(line.unit_price, currency)} = {formatMoney(line.total_amount, currency)}. Utledet pris per {unit} vises ikke før grunnlaget er kontrollert.</p>
        </div>
      )}
      {reasons.length > 0 && !gate.ok && !credit && <p className="text-caption text-warning">Må avklares: {reasons.join(" · ")}</p>}
      <button type="button" className="text-caption text-ink-secondary underline underline-offset-2" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Prisdetaljer
      </button>
      {open && (
        <dl className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-2 text-caption">
          <div>
            <dt className="text-ink-secondary">Fakturert</dt>
            <dd>
              {line.quantity ?? "—"} {line.unit ?? ""} × {formatMoney(line.unit_price, currency)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-secondary">Linjesum eks. mva</dt>
            <dd>{formatMoney(line.total_amount, currency)}</dd>
          </div>
          <div>
            <dt className="text-ink-secondary">Avtalepris</dt>
            <dd>{link?.agreed_price_per_base_unit != null ? `${formatMoney(Number(link.agreed_price_per_base_unit), "NOK")} / ${unit}` : "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-secondary">Siste fakturapris</dt>
            <dd>
              {link?.last_invoice_price != null ? `${formatMoney(Number(link.last_invoice_price), "NOK")} / ${unit}` : "—"}
              {link?.last_invoice_date ? ` (${formatDate(link.last_invoice_date)})` : ""}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
