import { useState } from "react";
import { Card } from "@/components/ui/card";
import { QueryState } from "@/components/common/QueryState";
import { useSupplierItems } from "@/fakturaer/hooks/useSupplierItems";
import { SupplierItemsTable } from "@/fakturaer/components/supplier-item/SupplierItemsTable";
import { SupplierItemSheet } from "@/fakturaer/components/supplier-item/SupplierItemSheet";
import type { SupplierItem } from "@/fakturaer/lib/supplierItems";

/** «Varekort hos leverandører» — alle leverandørvarer koblet til råvaren. */
export function SupplierItemsForMaterialCard({ rawMaterialId }: { rawMaterialId: string }) {
  const q = useSupplierItems({ rawMaterialId, pageSize: 50 });
  const [open, setOpen] = useState<SupplierItem | null>(null);
  const items = q.data?.items ?? [];
  return (
    <Card className="space-y-3 p-5">
      <h3 className="text-base font-semibold">Varekort hos leverandører</h3>
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} scope="ravarer:varekort-for-ravare" onRetry={() => void q.refetch()}
        isEmpty={items.length === 0} emptyTitle="Ingen varekort" emptyDescription="Ingen fakturalinjer er koblet til denne råvaren ennå.">
        <SupplierItemsTable items={items} onOpen={setOpen} />
      </QueryState>
      <SupplierItemSheet supplierId={open?.supplier_id ?? null} itemKey={open?.item_key ?? null} item={open} open={!!open} onOpenChange={(v) => { if (!v) setOpen(null); }} />
    </Card>
  );
}
