import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { TrendingUp } from "lucide-react";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { NewSupplierDialog } from "@/ravarer/components/NewSupplierDialog";
import { useRawMaterialSuppliers, usePriceHistory } from "@/ravarer/hooks/useRmSuppliers";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import { PriceTimeline } from "@/ravarer/components/PriceTimeline";
import { RecentInvoiceLinesCard } from "@/ravarer/components/RecentInvoiceLinesCard";
import type { TimelineHistoryRow, TimelineLink } from "@/ravarer/lib/priceTimeline";
import { PurchaseStatsCard } from "@/ravarer/components/PurchaseStatsCard";
import { StartPriceCard } from "@/ravarer/components/tabs/StartPriceCard";
import { useRawMaterialUnits } from "@/ravarer/hooks/useRawMaterialUnits";
import { RmSupplierDialog } from "./suppliers/RmSupplierDialog";
import { AddPriceDialog } from "./suppliers/AddPriceDialog";
import { SupplierLinksTable, BASE_UNIT_KEY } from "./suppliers/SupplierLinksTable";
import { PriceBasisNowCard } from "./suppliers/PriceBasisNowCard";
import { SupplierItemsForMaterialCard } from "./suppliers/SupplierItemsForMaterialCard";

interface Props {
  rm: RawMaterialRow;
}

export function SuppliersTab({ rm }: Props) {
  const { canWrite } = useRavarer();
  const { data: allSuppliers = [] } = useSuppliers();
  const { data: links = [], isLoading } = useRawMaterialSuppliers(rm.id);
  const { data: history = [] } = usePriceHistory(rm.id);

  const [linkOpen, setLinkOpen] = useState<{
    open: boolean;
    existingId?: string;
  }>({ open: false });
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceUnitId, setPriceUnitId] = useState<string>(BASE_UNIT_KEY);

  const { data: units = [] } = useRawMaterialUnits(rm.id);
  const selectedUnit = units.find((u) => u.id === priceUnitId) ?? null;
  const unitFactor = selectedUnit ? Number(selectedUnit.units_in_base) || 1 : 1;
  const unitLabel = selectedUnit ? selectedUnit.unit_label : rm.base_unit;


  const supplierMap = useMemo(
    () => new Map(allSuppliers.map((s) => [s.id, s])),
    [allSuppliers],
  );

  const timelineHistory = useMemo<TimelineHistoryRow[]>(
    () =>
      history.map((h) => ({
        id: h.id,
        effective_date: h.effective_date,
        price: Number(h.price),
        supplier_id: h.supplier_id,
        source: h.source,
        invoice_id: h.invoice_id,
        invoiceNumber: h.invoices?.invoice_number ?? null,
        isCreditNote: h.invoices?.is_credit_note ?? false,
        notes: h.notes,
      })),
    [history],
  );

  const timelineLinks = useMemo<TimelineLink[]>(
    () =>
      links.map((l) => ({
        supplier_id: l.supplier_id,
        agreed_price_per_base_unit: l.agreed_price_per_base_unit,
        agreement_valid_from: l.agreement_valid_from,
        agreement_valid_to: l.agreement_valid_to,
      })),
    [links],
  );

  const supplierNames = useMemo(
    () => new Map(allSuppliers.map((s) => [s.id, s.name])),
    [allSuppliers],
  );

  return (
    <div className="space-y-5">
      <PriceBasisNowCard rawMaterialId={rm.id} category={rm.category} baseUnit={rm.base_unit} links={links} supplierNames={supplierNames} />
      <SupplierItemsForMaterialCard rawMaterialId={rm.id} />
      <StartPriceCard links={links} supplierNames={supplierNames} currentBaseUnit={rm.base_unit} />
      <SupplierLinksTable
        links={links}
        supplierMap={supplierMap}
        units={units}
        priceUnitId={priceUnitId}
        onPriceUnit={setPriceUnitId}
        baseUnit={rm.base_unit}
        unitFactor={unitFactor}
        unitLabel={unitLabel}
        canWrite={canWrite}
        isLoading={isLoading}
        hasHistory={(sid) => history.some((h) => h.supplier_id === sid && h.source === "invoice" && !h.is_legacy)}
        onNewSupplier={() => setSupplierOpen(true)}
        onLink={(existingId) => setLinkOpen({ open: true, existingId })}
      />

      <PriceTimeline
        history={timelineHistory}
        supplierNames={supplierNames}
        links={timelineLinks}
        baseUnit={rm.base_unit}
        baseUnitsPerPackage={rm.base_units_per_package}
        title="Pristidslinje"
        exportName={`priser-${rm.sku}`}
        actions={
          canWrite ? (
            <Button size="sm" onClick={() => setPriceOpen(true)}>
              <TrendingUp className="mr-1.5 h-3.5 w-3.5" /> Registrer pris
            </Button>
          ) : null
        }
      />

      <RecentInvoiceLinesCard rawMaterialId={rm.id} baseUnit={rm.base_unit} />
      <PurchaseStatsCard rawMaterialId={rm.id} baseUnit={rm.base_unit} />

      <NewSupplierDialog open={supplierOpen} onOpenChange={setSupplierOpen} />
      <RmSupplierDialog
        key={linkOpen.existingId ?? "new"}
        open={linkOpen.open}
        // `existingId` må overleve lukkingen — ellers bytter dialogens `key`
        // til «new» i samme render som lukkeanimasjonen, og skjemaet blanker.
        onOpenChange={(v: boolean) => setLinkOpen((prev) => ({ ...prev, open: v }))}
        rawMaterialId={rm.id}
        baseUnit={rm.base_unit}
        existing={links.find((l) => l.id === linkOpen.existingId) ?? null}
      />
      <AddPriceDialog
        open={priceOpen}
        onOpenChange={setPriceOpen}
        rm={rm}
        suppliers={links.map((l) => ({
          id: l.supplier_id,
          name: supplierMap.get(l.supplier_id)?.name ?? "—",
        }))}
      />
    </div>
  );
}
