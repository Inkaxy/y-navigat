import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Save } from "lucide-react";
import { useRawMaterialNutrition, useSaveRawMaterialNutrition } from "@/varer/hooks/useMissingNutrition";

export const NUTRITION_FIELDS = [
  { key: "energy_kj", label: "Energi (kJ)" },
  { key: "energy_kcal", label: "Energi (kcal)" },
  { key: "fat_g", label: "Fett (g)" },
  { key: "saturated_fat_g", label: "— hvorav mettede fettsyrer (g)" },
  { key: "carbs_g", label: "Karbohydrater (g)" },
  { key: "sugars_g", label: "— hvorav sukkerarter (g)" },
  { key: "fiber_g", label: "Kostfiber (g)" },
  { key: "protein_g", label: "Protein (g)" },
  { key: "salt_g", label: "Salt (g)" },
] as const;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rawMaterialId: string | null;
  rawMaterialName: string;
  onSaved?: () => void;
}

/** Manuell registrering av næringsdata per 100 g på en råvare. */
export function ManualNutritionDialog({ open, onOpenChange, rawMaterialId, rawMaterialName, onSaved }: Props) {
  const nutQuery = useRawMaterialNutrition(open && rawMaterialId ? rawMaterialId : undefined);
  const save = useSaveRawMaterialNutrition();
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const d = nutQuery.data as Record<string, unknown> | null | undefined;
    const next: Record<string, string> = {};
    for (const f of NUTRITION_FIELDS) {
      const v = d?.[f.key];
      next[f.key] = v != null ? String(v) : "";
    }
    setValues(next);
  }, [nutQuery.data, open]);

  async function submit() {
    if (!rawMaterialId) return;
    const out: Record<string, number | null> = {};
    for (const f of NUTRITION_FIELDS) {
      const raw = values[f.key];
      out[f.key] = raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : null;
    }
    await save.mutateAsync({ raw_material_id: rawMaterialId, values: out });
    onSaved?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Næringsdata — {rawMaterialName}</DialogTitle>
        </DialogHeader>
        {nutQuery.isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Verdier per 100 g av råvaren, slik de står på databladet.</p>
            {NUTRITION_FIELDS.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-3">
                <span className="text-sm">{f.label}</span>
                <Input
                  type="number"
                  step="0.1"
                  className="h-8 w-32 text-right"
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={submit} disabled={save.isPending || !rawMaterialId}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Lagre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
