import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useUpdateRawMaterial, type RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import { useRawMaterialProducts } from "@/ravarer/hooks/useStock";

/** Handelsvare-bryteren. Lagerføring bor i sitt eget kort og gjelder alle varer. */
export function ResaleSettingsCard({ rm }: { rm: RawMaterialRow }) {
  const { canWrite } = useRavarer();
  const update = useUpdateRawMaterial();
  const { data: links = [] } = useRawMaterialProducts(rm.is_resale_item ? rm.id : undefined);

  const toggleResale = async (v: boolean) => {
    await update.mutateAsync({ id: rm.id, is_resale_item: v });
  };

  return (
    <Card className="p-5 space-y-4">
      <h3 className="text-base font-semibold">Handelsvare</h3>

      <div className="flex items-start justify-between gap-4">
        <div>
          <Label>Handelsvare — selges videre uendret</Label>
          <p className="text-xs text-ink-secondary">Kjøpes inn og selges uten bearbeiding, som brus, kaffe og sjokolade.</p>
        </div>
        <Switch checked={rm.is_resale_item} onCheckedChange={toggleResale} disabled={!canWrite || update.isPending} />
      </div>

      {rm.is_resale_item && rm.stock_tracking && links.length === 0 && (
        <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            Ingen vare er koblet under «Selges som». Lageret fylles opp av innkjøp uten at noe trekkes fra ved salg.
          </span>
        </div>
      )}
    </Card>
  );
}
