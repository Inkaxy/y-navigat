import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, History } from "lucide-react";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useUpdateRawMaterial, type RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import { useHasMovements } from "@/ravarer/hooks/useStock";
import { StockAdjustDialog, type AdjustMode } from "./StockAdjustDialog";
import { StockMovementsSheet } from "./StockMovementsSheet";
import { formatNumber } from "@/ravarer/lib/constants";

/** Lagerføring for alle varetyper — bryter, minimum og åpningssaldo. */
export function StockTrackingCard({ rm }: { rm: RawMaterialRow }) {
  const { canWrite } = useRavarer();
  const update = useUpdateRawMaterial();
  const { data: hasMovements } = useHasMovements(rm.id);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [mode, setMode] = useState<AdjustMode>("opening");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [minDraft, setMinDraft] = useState(rm.min_stock == null ? "" : String(rm.min_stock));

  useEffect(() => {
    setMinDraft(rm.min_stock == null ? "" : String(rm.min_stock));
  }, [rm.min_stock]);

  const toggleTracking = async (v: boolean) => {
    await update.mutateAsync({ id: rm.id, stock_tracking: v });
    if (v && hasMovements === false) {
      setMode("opening");
      setAdjustOpen(true);
    }
  };

  const saveMin = async () => {
    const raw = minDraft.trim();
    const next = raw === "" ? null : Number(raw.replace(",", "."));
    if (next != null && !Number.isFinite(next)) return;
    if (next === (rm.min_stock == null ? null : Number(rm.min_stock))) return;
    await update.mutateAsync({ id: rm.id, min_stock: next });
  };

  const openAdjust = (m: AdjustMode) => {
    setMode(m);
    setAdjustOpen(true);
  };

  return (
    <Card className="p-5 space-y-4">
      <h3 className="text-base font-semibold">Lagerføring</h3>

      <div className="flex items-start justify-between gap-4">
        <div>
          <Label>Før lagerbeholdning</Label>
          <p className="text-xs text-ink-secondary">
            Beholdningen oppdateres automatisk av innkjøp, salg, retur og oppskriftsuttrekk ved kjørt pakkseddel. Nå:{" "}
            {formatNumber(rm.current_stock, 3)} {rm.base_unit}
          </p>
        </div>
        <Switch checked={rm.stock_tracking} onCheckedChange={toggleTracking} disabled={!canWrite || update.isPending} />
      </div>

      {rm.stock_tracking && (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-[220px]">
              <Label className="text-xs">Min. beholdning ({rm.base_unit})</Label>
              <Input
                value={minDraft}
                onChange={e => setMinDraft(e.target.value)}
                onBlur={saveMin}
                inputMode="decimal"
                placeholder="Ikke satt"
                disabled={!canWrite}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => openAdjust("count")} disabled={!canWrite}>
                <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" /> Registrer telling
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSheetOpen(true)}>
                <History className="mr-1.5 h-3.5 w-3.5" /> Bevegelser
              </Button>
            </div>
          </div>
        </>
      )}

      <StockAdjustDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        mode={mode}
        rawMaterial={{ id: rm.id, name: rm.name, base_unit: rm.base_unit, current_stock: rm.current_stock }}
      />
      <StockMovementsSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        rawMaterial={{ id: rm.id, name: rm.name, base_unit: rm.base_unit }}
      />
    </Card>
  );
}
