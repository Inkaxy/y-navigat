import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CostPriceEditor } from "@/ravarer/editors/CostPriceEditor";
import { PrimarySupplierControl } from "@/ravarer/editors/PrimarySupplierControl";
import type { RawMaterialListItem } from "@/ravarer/lib/rawMaterialViews";

interface Props {
  items: RawMaterialListItem[];
  costFor: string | null;
  onCostClose: () => void;
  primaryFor: string | null;
  onPrimaryClose: () => void;
  suppliers: { id: string; name: string }[];
}

/** Kostpris (CostPriceEditor) og «Velg primærleverandør først» fra varelisten. */
export function VarelistePriceDialogs({ items, costFor, onCostClose, primaryFor, onPrimaryClose, suppliers }: Props) {
  const costItem = costFor ? items.find((i) => i.id === costFor) ?? null : null;
  const primaryItem = primaryFor ? items.find((i) => i.id === primaryFor) ?? null : null;
  const linkedFor = (it: RawMaterialListItem | null) =>
    it?.supplierId && it.supplierName ? [{ id: it.supplierId, name: it.supplierName }] : [];
  return (
    <>
      {costItem && (
        <CostPriceEditor
          open
          onOpenChange={(v) => { if (!v) onCostClose(); }}
          rawMaterialId={costItem.id}
          rawMaterialName={costItem.name}
          baseUnit={costItem.baseUnit}
          suppliers={suppliers}
          initialPrice={costItem.costPrice}
          initialSupplierId={costItem.supplierId}
        />
      )}
      <Dialog open={!!primaryItem} onOpenChange={(v) => { if (!v) onPrimaryClose(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Velg primærleverandør først</DialogTitle>
            <DialogDescription>
              Avtaleprisen lagres på koblingen til primærleverandøren{primaryItem ? ` for ${primaryItem.name}` : ""}.
            </DialogDescription>
          </DialogHeader>
          {primaryItem && (
            <PrimarySupplierControl
              rawMaterialId={primaryItem.id}
              currentSupplierId={primaryItem.supplierId}
              linkedSuppliers={linkedFor(primaryItem)}
              allSuppliers={suppliers}
              onChanged={onPrimaryClose}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
