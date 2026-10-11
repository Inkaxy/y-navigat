import { Link } from "react-router-dom";
import { BookOpenCheck, Receipt } from "lucide-react";
import { formatDate, formatMoney } from "@/fakturaer/lib/constants";
import { LineStatusBadge } from "@/fakturaer/components/inbox/LineStatusBadge";
import { lineKindLabel, reasonLabelsOf, type SupplierItemLine } from "@/fakturaer/lib/supplierItems";
import { isOpenLine } from "@/fakturaer/lib/linkFormLogic";
import type { StatusTone } from "@/fakturaer/lib/lineStatus";
import { paths } from "@/ravarer/lib/paths";

function lineStatus(l: SupplierItemLine): { label: string; tone: StatusTone } {
  if (l.line_kind && l.line_kind !== "vare" && !l.raw_material_id) return { label: "Ikke vare", tone: "muted" };
  if (isOpenLine(l)) return { label: reasonLabelsOf(l.review_reason)[0] ?? "Til kontroll", tone: "warning" };
  if (!l.raw_material_id) return { label: "Ikke koblet", tone: "muted" };
  return { label: "Klar", tone: "success" };
}

const n = (v: number | null) => (v == null ? "—" : v.toLocaleString("nb-NO", { maximumFractionDigits: 3 }));

export function SupplierItemHistory({ lines, baseUnit }: { lines: SupplierItemLine[]; baseUnit?: string | null }) {
  const per = baseUnit ? `kr/${baseUnit}` : "kr per grunnenhet";
  return (
    <ul className="divide-y divide-line-subtle text-sm">
      {lines.map((l) => (
        <li key={l.id} className="space-y-1 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tabular-nums text-ink-secondary">{formatDate(l.invoice_date)}</span>
            <Link to={paths.faktura(l.invoice_id)} className="font-medium underline-offset-2 hover:underline">
              {l.invoice_number ?? "Faktura"}
            </Link>
            <span className="tabular-nums">{n(l.quantity)} {l.unit ?? ""}</span>
            <span className="tabular-nums">{formatMoney(l.total_amount, "NOK")}</span>
            <span className="tabular-nums text-ink-secondary">
              {l.price_per_base_unit == null ? "—" : `${n(Math.round(l.price_per_base_unit * 100) / 100)} ${per}`}
            </span>
            <LineStatusBadge status={lineStatus(l)} />
            {lineKindLabel(l.line_kind) && l.line_kind !== "vare" && (
              <span className="rounded border border-line-subtle px-1.5 text-[11px] text-ink-secondary">{lineKindLabel(l.line_kind)}</span>
            )}
            {l.cost_posted && <Receipt className="h-3.5 w-3.5 text-ink-secondary" aria-label="Kostpris ført" />}
            {l.in_price_history && <BookOpenCheck className="h-3.5 w-3.5 text-ink-secondary" aria-label="I prishistorikken" />}
          </div>
          {l.resolution_note && <p className="text-caption text-ink-secondary">{l.resolution_note}</p>}
        </li>
      ))}
    </ul>
  );
}
