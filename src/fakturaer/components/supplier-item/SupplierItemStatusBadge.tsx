import { LineStatusBadge } from "@/fakturaer/components/inbox/LineStatusBadge";
import { SUPPLIER_ITEM_STATUS_META, type SupplierItemStatus } from "@/fakturaer/lib/supplierItems";

export function SupplierItemStatusBadge({ status }: { status: SupplierItemStatus }) {
  return <LineStatusBadge status={SUPPLIER_ITEM_STATUS_META[status] ?? { label: "Ukjent", tone: "muted" }} />;
}
