import { useState } from "react";
import { formatDate, formatMoney } from "@/fakturaer/lib/constants";
import { fmtNum } from "@/fakturaer/lib/units";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { SupplierLinkRow } from "@/fakturaer/hooks/useSupplierLinkContext";
import { baseUnitOf, reasonsIn } from "@/fakturaer/lib/lineControl";

function referenceLabel(line: ReviewLineRow): string | null {
  const d = line.price_reference_date ? ` ${formatDate(line.price_reference_date)}` : "";
  switch (line.price_reference_source) {
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
  const currency = line.invoice.currency ?? "NOK";
  const unit = baseUnitOf(line, link) ?? "grunnenhet";
  const actual = line.price_per_base_unit == null ? null : Number(line.price_per_base_unit);
  const expected = line.expected_price_per_base_unit == null ? null : Number(line.expected_price_per_base_unit);
  const ref = referenceLabel(line);
  const variance = line.price_variance_pct == null ? null : Number(line.price_variance_pct);
  const reasons = reasonsIn(line, "price");

  return (
    <div className="space-y-2 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-caption text-ink-secondary">Denne fakturaen</div>
          <div className="text-base font-semibold tabular-nums">
            {actual == null ? "Kan ikke beregnes" : `${formatMoney(actual, currency)} / ${unit}`}
          </div>
        </div>
        <div>
          <div className="text-caption text-ink-secondary">Sammenlignes med{ref ? ` ${ref}` : ""}</div>
          <div className="text-base font-semibold tabular-nums">
            {expected == null ? "Mangler prisgrunnlag" : `${formatMoney(expected, currency)} / ${unit}`}
          </div>
        </div>
      </div>
      {variance != null && (
        <p className="text-caption">
          {variance > 0 ? "+" : ""}
          {fmtNum(variance, 1)} % · toleranse {fmtNum(tolerancePct, 1)} %
        </p>
      )}
      {reasons.length > 0 && variance == null && <p className="text-caption text-warning">Må avklares: {reasons.join(" · ")}</p>}
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
