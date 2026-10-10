import { Link } from "react-router-dom";
import { useSupplierItems } from "@/fakturaer/hooks/useSupplierItems";
import { SUPPLIER_ITEM_STATUS_META, type SupplierItemStatus } from "@/fakturaer/lib/supplierItems";

const SHOWN: SupplierItemStatus[] = ["ukoblet", "mangler_pakning", "prisavvik", "kontroll", "koblet"];

/** Varekort-status for én leverandør, som lenker til Varekoblinger. */
export function SupplierItemStatusChips({ supplierId }: { supplierId: string }) {
  const counts = useSupplierItems({ supplierId, pageSize: 1 }).data?.counts;
  if (!counts) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Varekort hos leverandøren">
      <span className="text-caption text-ink-secondary">Varekort:</span>
      {SHOWN.map((s) => (
        <Link key={s} to={`/ravarer/priskontroll?fane=gjore&leverandor=${encodeURIComponent(supplierId)}&status=${s}`}
          className="rounded-full border border-line-subtle px-3 py-1 text-sm hover:bg-muted">
          {SUPPLIER_ITEM_STATUS_META[s].label} <span className="tabular-nums">{counts[s]}</span>
        </Link>
      ))}
    </div>
  );
}
