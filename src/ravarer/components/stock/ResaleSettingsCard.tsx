import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useUpdateRawMaterial, type RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import { useHasMovements, useRawMaterialProducts } from "@/ravarer/hooks/useStock";
import { StockAdjustDialog } from "./StockAdjustDialog";
import { formatNumber } from "@/ravarer/lib/constants";

/** Bryterne for handelsvare + lagerføring, med førstegangsoppsett. */
export function ResaleSettingsCard({ rm }: { rm: RawMaterialRow }) {
  const { canWrite } = useRavarer();
  const update = useUpdateRawMaterial();
  const { data: hasMovements } = useHasMovements(rm.id);
  const { data: links = [] } = useRawMaterialProducts(rm.is_resale_item ? rm.id : undefined);
  const [openingOpen, setOpeningOpen] = useState(false);

  const toggleResale = async (v: boolean) => {
    await update.mutateAsync({ id: rm.id, is_resale_item: v, ...(v ? {} : { stock_tracking: false }) });
  };

  const toggleTracking = async (v: boolean) => {
    await update.mutateAsync({ id: rm.id, stock_tracking: v });
    if (v && hasMovements === false) setOpeningOpen(true);
  };

  return (
    <Card className="p-5 space-y-4">
      <h3 className="text-base font-semibold">Handelsvare og lager</h3>

      <div className="flex items-start justify-between gap-4">
        <div>
          <Label>Handelsvare — selges videre uendret</Label>
          <p className="text-xs text-ink-secondary">Kjøpes inn og selges uten bearbeiding, som brus, kaffe og sjokolade.</p>
        </div>
        <Switch checked={rm.is_resale_item} onCheckedChange={toggleResale} disabled={!canWrite || update.isPending} />
      </div>

      <div className={`flex items-start justify-between gap-4 ${rm.is_resale_item ? "" : "opacity-50"}`}>
        <div>
          <Label>Før lagerbeholdning</Label>
          <p className="text-xs text-ink-secondary">
            Beholdningen oppdateres automatisk av innkjøp, salg og retur. Nå: {formatNumber(rm.current_stock, 3)} {rm.base_unit}
          </p>
        </div>
        <Switch
          checked={rm.stock_tracking}
          onCheckedChange={toggleTracking}
          disabled={!canWrite || !rm.is_resale_item || update.isPending}
        />
      </div>

      {rm.is_resale_item && rm.stock_tracking && links.length === 0 && (
        <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            Ingen vare er koblet under «Selges som». Lageret fylles opp av innkjøp uten at noe trekkes fra ved salg.
          </span>
        </div>
      )}

      <StockAdjustDialog
        open={openingOpen}
        onOpenChange={setOpeningOpen}
        mode="opening"
        rawMaterial={{ id: rm.id, name: rm.name, base_unit: rm.base_unit, current_stock: rm.current_stock }}
      />
    </Card>
  );
}
