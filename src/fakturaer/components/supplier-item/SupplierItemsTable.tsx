import { formatDate, formatMoney } from "@/fakturaer/lib/constants";
import { packageText, pctChange, reasonSummary, type SupplierItem } from "@/fakturaer/lib/supplierItems";
import { SupplierItemStatusBadge } from "./SupplierItemStatusBadge";
import { cn } from "@/lib/utils";

function PriceCell({ i }: { i: SupplierItem }) {
  if (i.last_ppbu == null) return <span className="text-ink-secondary">—</span>;
  const d = pctChange(i.last_ppbu, i.prev_ppbu);
  return (
    <span className="tabular-nums">
      {formatMoney(i.last_ppbu, "NOK")}{i.rm_base_unit ? ` / ${i.rm_base_unit}` : ""}
      {d != null && Math.abs(d) >= 0.05 && (
        <span className={cn("ml-1 text-caption", d > 0 ? "text-destructive" : "text-success")}>
          {d > 0 ? "+" : "−"}{Math.abs(d).toLocaleString("nb-NO", { maximumFractionDigits: 1 })} %
        </span>
      )}
    </span>
  );
}

function LinesCell({ i }: { i: SupplierItem }) {
  const reasons = i.open_lines > 0 ? reasonSummary(i.reasons_raw) : [];
  return (
    <div>
      <span className="tabular-nums">{i.open_lines > 0 ? `${i.open_lines} åpne av ${i.line_count}` : `${i.line_count} linjer`}</span>
      {reasons.length > 0 && <div className="text-caption text-ink-secondary">{reasons.join(" · ")}</div>}
    </div>
  );
}

const rm = (i: SupplierItem) => (i.rm_name ? `${i.rm_name}${i.rm_base_unit ? ` (${i.rm_base_unit})` : ""}` : "—");

export function SupplierItemsTable({ items, onOpen }: { items: SupplierItem[]; onOpen: (i: SupplierItem) => void }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-md border border-line-subtle md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-caption text-ink-secondary">
            <tr>
              {["Leverandør", "Varenr.", "Beskrivelse (siste)", "Råvare", "Pakning", "Siste pris", "Linjer", "Sist sett", "Status"].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {items.map((i) => (
              <tr
                key={`${i.supplier_id}|${i.item_key}`}
                tabIndex={0}
                onClick={() => onOpen(i)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(i); } }}
                className="cursor-pointer align-top hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
              >
                <td className="px-3 py-2">{i.supplier_name ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{i.supplier_sku ?? "—"}</td>
                <td className="px-3 py-2">{i.description ?? "—"}</td>
                <td className="px-3 py-2">{rm(i)}</td>
                <td className="px-3 py-2">{packageText(i)}</td>
                <td className="px-3 py-2"><PriceCell i={i} /></td>
                <td className="px-3 py-2"><LinesCell i={i} /></td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDate(i.last_seen)}</td>
                <td className="px-3 py-2"><SupplierItemStatusBadge status={i.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden">
        {items.map((i) => (
          <li key={`${i.supplier_id}|${i.item_key}`}>
            <button type="button" onClick={() => onOpen(i)} className="w-full space-y-1 rounded-md border border-line-subtle p-3 text-left text-sm hover:bg-muted/40">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{i.description ?? "—"}</span>
                <SupplierItemStatusBadge status={i.status} />
              </div>
              <div className="text-caption text-ink-secondary">{i.supplier_name ?? "—"}{i.supplier_sku ? ` · ${i.supplier_sku}` : ""} · sist sett {formatDate(i.last_seen)}</div>
              <div>Råvare: {rm(i)}</div>
              <div className="text-caption">Pakning: {packageText(i)}</div>
              <div className="flex flex-wrap justify-between gap-2"><PriceCell i={i} /><LinesCell i={i} /></div>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
