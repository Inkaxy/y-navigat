import { useMemo, useState } from "react";
import { QueryState } from "@/components/common/QueryState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PriceTimeline } from "@/ravarer/components/PriceTimeline";
import { useTimelineHistory } from "@/ravarer/hooks/useRmSuppliers";
import { isAgreementConfirmed } from "@/ravarer/lib/priceTimeline";
import type { SupplierItemRow } from "@/ravarer/hooks/useSupplierDetail";

/** Prisutvikling for én av leverandørens varer (låste historikk-snapshots fra fase 4), med CSV. */
export function SupplierPriceTimeline({ supplierId, supplierName, items }: { supplierId: string; supplierName: string; items: SupplierItemRow[] }) {
  const sorted = useMemo(() => [...items].sort((a, b) => (a.raw_material?.name ?? "").localeCompare(b.raw_material?.name ?? "", "nb")), [items]);
  const [rawMaterialId, setRawMaterialId] = useState(sorted[0]?.raw_material_id ?? "");
  const selected = sorted.find((i) => i.raw_material_id === rawMaterialId) ?? sorted[0] ?? null;
  const historyQuery = useTimelineHistory(selected?.raw_material_id);
  const supplierNames = useMemo(() => new Map<string, string>([[supplierId, supplierName]]), [supplierId, supplierName]);
  const links = useMemo(
    () => selected ? [{
      supplier_id: supplierId,
      agreed_price_per_base_unit: selected.agreed_price_per_base_unit,
      agreement_valid_from: selected.agreement_valid_from,
      agreement_valid_to: selected.agreement_valid_to,
      agreement_confirmed: isAgreementConfirmed(selected),
    }] : [],
    [selected, supplierId],
  );
  const rows = useMemo(() => historyQuery.rows.filter((h) => h.supplier_id === supplierId), [historyQuery.rows, supplierId]);
  if (!selected) return null;
  if (historyQuery.isError || historyQuery.isLoading) {
    return (
      <QueryState isLoading={historyQuery.isLoading} isError={historyQuery.isError} error={historyQuery.error} scope="leverandor-prisutvikling"
        onRetry={() => void historyQuery.refetch()} errorTitle="Kunne ikke hente prishistorikken">{null}</QueryState>
    );
  }
  return (
    <PriceTimeline
      history={rows}
      supplierNames={supplierNames}
      links={links}
      baseUnit={selected.raw_material?.base_unit ?? "enhet"}
      title={`Prisutvikling — ${selected.raw_material?.name ?? "vare"}`}
      exportName={`prisutvikling-${supplierName}`}
      projectionError={historyQuery.projectionError}
      onRetryProjection={historyQuery.retryProjection}
      actions={
        <Select value={selected.raw_material_id} onValueChange={setRawMaterialId}>
          <SelectTrigger className="h-[44px] w-full sm:w-[240px] md:h-9" aria-label="Velg vare"><SelectValue /></SelectTrigger>
          <SelectContent>
            {sorted.map((i) => <SelectItem key={i.id} value={i.raw_material_id}>{i.raw_material?.name ?? "Ukjent vare"}</SelectItem>)}
          </SelectContent>
        </Select>
      }
    />
  );
}
