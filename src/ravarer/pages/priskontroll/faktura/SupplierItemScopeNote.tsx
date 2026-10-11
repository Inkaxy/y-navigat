import { useSupplierItems } from "@/fakturaer/hooks/useSupplierItems";
import { supplierItemKey } from "@/fakturaer/lib/supplierItemKey";

/** Øverst i inspektøren når linjens varekort har flere åpne linjer. */
export function SupplierItemScopeNote({ supplierId, line }: { supplierId: string | null; line: { supplier_sku?: string | null; description?: string | null } }) {
  const key = supplierItemKey(line);
  const { data } = useSupplierItems({ supplierId, itemKey: key, pageSize: 1, enabled: !!supplierId && !!key });
  const open = data?.items[0]?.open_lines ?? 0;
  if (open <= 1) return null;
  return (
    <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-caption text-ink-secondary">
      Dette gjelder bare denne linjen. Vil du bestemme for alle fakturaer ({open} åpne linjer), åpne varekortet.
    </p>
  );
}
