import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { QueryState } from "@/components/common/QueryState";
import { useSupplierItems } from "@/fakturaer/hooks/useSupplierItems";
import { SupplierItemsTable } from "@/fakturaer/components/supplier-item/SupplierItemsTable";
import { paths } from "@/ravarer/lib/paths";
import { varekortKey } from "@/ravarer/pages/priskontroll/gjore/logic";

/** «Varekort hos leverandører» — alle leverandørvarer koblet til råvaren. Radklikk åpner varekortet i Å gjøre. */
export function SupplierItemsForMaterialCard({ rawMaterialId }: { rawMaterialId: string }) {
  const q = useSupplierItems({ rawMaterialId, pageSize: 50 });
  const navigate = useNavigate();
  const items = q.data?.items ?? [];
  return (
    <Card className="space-y-3 p-5">
      <h3 className="text-base font-semibold">Varekort hos leverandører</h3>
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} scope="ravarer:varekort-for-ravare" onRetry={() => void q.refetch()}
        isEmpty={items.length === 0} emptyTitle="Ingen varekort" emptyDescription="Ingen fakturalinjer er koblet til denne råvaren ennå.">
        <SupplierItemsTable items={items} onOpen={(it) => navigate(paths.priskontroll({ fane: "gjore", valgt: varekortKey(it.supplier_id, it.item_key) }))} />
      </QueryState>
    </Card>
  );
}
