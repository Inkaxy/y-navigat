import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { TrendingUp } from "lucide-react";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { NewSupplierDialog } from "@/ravarer/components/NewSupplierDialog";
import { useRawMaterialSuppliers, useTimelineHistory, type RmSupplierRow } from "@/ravarer/hooks/useRmSuppliers";
import { PackageEditor } from "@/ravarer/editors/PackageEditor";
import { fallbackPackageRow } from "@/ravarer/lib/packageRow";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import { PriceTimeline } from "@/ravarer/components/PriceTimeline";
import { RecentInvoiceLinesCard } from "@/ravarer/components/RecentInvoiceLinesCard";
import { isAgreementConfirmed, type TimelineLink } from "@/ravarer/lib/priceTimeline";
import { PurchaseStatsCard } from "@/ravarer/components/PurchaseStatsCard";
import { StartPriceCard } from "@/ravarer/components/tabs/StartPriceCard";
import { useRawMaterialUnits } from "@/ravarer/hooks/useRawMaterialUnits";
import { RmSupplierDialog } from "./suppliers/RmSupplierDialog";
import { CostPriceEditor } from "@/ravarer/editors/CostPriceEditor";
import { SupplierLinksTable, BASE_UNIT_KEY } from "./suppliers/SupplierLinksTable";
import { PriceBasisNowCard } from "./suppliers/PriceBasisNowCard";
import { SupplierItemsForMaterialCard } from "./suppliers/SupplierItemsForMaterialCard";
import { QueryErrorState, QueryLoadingState } from "@/components/common/QueryState";

interface Props {
  rm: RawMaterialRow;
  /** Seksjon på råvarekortet: «pris» (prisgrunnlag/historikk) eller «leverandorer» (koblinger/varekort). Udefinert = begge. */
  part?: "pris" | "leverandorer";
}

export function SuppliersTab({ rm, part }: Props) {
  const show = (p: "pris" | "leverandorer") => !part || part === p;
  const { canWrite } = useRavarer();
  const { data: allSuppliers = [] } = useSuppliers();
  const { data: links = [], isLoading } = useRawMaterialSuppliers(rm.id);
  const historyQuery = useTimelineHistory(rm.id);
  const history = historyQuery.raw;

  const [linkOpen, setLinkOpen] = useState<{
    open: boolean;
    existingId?: string;
  }>({ open: false });
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [packageLink, setPackageLink] = useState<RmSupplierRow | null>(null);
  const packageRow = useMemo(() => fallbackPackageRow(rm), [rm]);
  const [priceUnitId, setPriceUnitId] = useState<string>(BASE_UNIT_KEY);

  const { data: units = [] } = useRawMaterialUnits(rm.id);
  const selectedUnit = units.find((u) => u.id === priceUnitId) ?? null;
  const unitFactor = selectedUnit ? Number(selectedUnit.units_in_base) || 1 : 1;
  const unitLabel = selectedUnit ? selectedUnit.unit_label : rm.base_unit;


  const supplierMap = useMemo(
    () => new Map(allSuppliers.map((s) => [s.id, s])),
    [allSuppliers],
  );

  const timelineHistory = historyQuery.rows;

  const timelineLinks = useMemo<TimelineLink[]>(
    () =>
      links.map((l) => ({
        supplier_id: l.supplier_id,
        agreed_price_per_base_unit: l.agreed_price_per_base_unit,
        agreement_valid_from: l.agreement_valid_from,
        agreement_valid_to: l.agreement_valid_to,
        agreement_confirmed: isAgreementConfirmed(l),
      })),
    [links],
  );

  const supplierNames = useMemo(
    () => new Map(allSuppliers.map((s) => [s.id, s.name])),
    [allSuppliers],
  );

  return (
    <div className="space-y-5">
      {show("pris") && <PriceBasisNowCard rawMaterialId={rm.id} category={rm.category} baseUnit={rm.base_unit} links={links} supplierNames={supplierNames} />}
      {show("leverandorer") && <SupplierItemsForMaterialCard rawMaterialId={rm.id} />}
      {show("pris") && <StartPriceCard links={links} supplierNames={supplierNames} currentBaseUnit={rm.base_unit} />}
      {show("leverandorer") && <SupplierLinksTable
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
      />}

      {!show("pris") ? null : historyQuery.isError ? (
        <QueryErrorState error={historyQuery.error} scope="ravarer:pristidslinje" title="Kunne ikke hente prishistorikken" onRetry={() => void historyQuery.refetch()} />
      ) : historyQuery.isLoading ? (
        <QueryLoadingState />
      ) : (
      <PriceTimeline
        history={timelineHistory}
        supplierNames={supplierNames}
        links={timelineLinks}
        baseUnit={rm.base_unit}
        baseUnitsPerPackage={rm.base_units_per_package}
        title="Pristidslinje"
        exportName={`priser-${rm.sku}`}
        projectionError={historyQuery.projectionError}
        onRetryProjection={historyQuery.retryProjection}
        actions={
          canWrite ? (
            <Button size="sm" onClick={() => setPriceOpen(true)}>
              <TrendingUp className="mr-1.5 h-3.5 w-3.5" /> Registrer pris
            </Button>
          ) : null
        }
      />
      )}

      {show("pris") && <RecentInvoiceLinesCard rawMaterialId={rm.id} baseUnit={rm.base_unit} eligibleLineIds={historyQuery.eligibleLineIds} />}
      {show("pris") && <PurchaseStatsCard rawMaterialId={rm.id} baseUnit={rm.base_unit} />}

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
        onEditPackage={(l) => {
          setLinkOpen((prev) => ({ ...prev, open: false }));
          setPackageLink(l);
        }}
      />
      <PackageEditor
        key={packageLink?.id ?? "none"}
        row={packageRow}
        open={!!packageLink}
        onOpenChange={(v) => { if (!v) setPackageLink(null); }}
        forceSupplierSection
        supplierOnly={!!packageLink}
        initialSupplier={packageLink ? { supplierId: packageLink.supplier_id, supplierUnits: packageLink.base_units_per_package ?? null } : null}
      />
      <CostPriceEditor
        open={priceOpen}
        onOpenChange={setPriceOpen}
        rawMaterialId={rm.id}
        rawMaterialName={rm.name}
        baseUnit={rm.base_unit}
        initialSupplierId={rm.primary_supplier_id}
        suppliers={links.map((l) => ({
          id: l.supplier_id,
          name: supplierMap.get(l.supplier_id)?.name ?? "—",
        }))}
      />
    </div>
  );
}
