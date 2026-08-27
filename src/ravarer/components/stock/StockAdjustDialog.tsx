import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateStockMovement } from "@/ravarer/hooks/useStock";
import { useRawMaterialUnits } from "@/ravarer/hooks/useRawMaterialUnits";
import { formatNumber } from "@/ravarer/lib/constants";

export type AdjustMode = "count" | "waste" | "opening";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: AdjustMode;
  rawMaterial: { id: string; name: string; base_unit: string; current_stock: number } | null;
}

const TITLES: Record<AdjustMode, string> = {
  count: "Registrer telling",
  waste: "Registrer svinn",
  opening: "Hva står på lager nå?",
};

const BASE = "__base__";

export function StockAdjustDialog({ open, onOpenChange, mode, rawMaterial }: Props) {
  const create = useCreateStockMovement();
  const { data: units = [] } = useRawMaterialUnits(open ? rawMaterial?.id : undefined);
  const [value, setValue] = useState("");
  const [extra, setExtra] = useState("");
  const [unitId, setUnitId] = useState<string>(BASE);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setValue("");
      setExtra("");
      setNote("");
      setUnitId(BASE);
    }
  }, [open, rawMaterial?.id, mode]);

  useEffect(() => {
    const def = units.find(u => u.is_default_count);
    if (open && def) setUnitId(def.id);
  }, [open, units]);

  if (!rawMaterial) return null;

  const selectedUnit = units.find(u => u.id === unitId) ?? null;
  const factor = selectedUnit ? Number(selectedUnit.units_in_base) || 1 : 1;

  const parsed = Number(String(value).replace(",", "."));
  const parsedExtra = extra.trim() === "" ? 0 : Number(String(extra).replace(",", "."));
  const valid = value.trim() !== "" && Number.isFinite(parsed) && Number.isFinite(parsedExtra);
  /** Mengden omregnet til baseenhet. */
  const numeric = valid ? parsed * factor + parsedExtra : NaN;

  const diff = mode === "count" && valid ? numeric - rawMaterial.current_stock : 0;
  const noteRequired = mode !== "opening";
  const canSubmit =
    valid &&
    (!noteRequired || note.trim().length > 0) &&
    (mode !== "waste" || numeric > 0) &&
    (mode !== "count" || diff !== 0) &&
    !create.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    if (mode === "count") {
      await create.mutateAsync({
        raw_material_id: rawMaterial.id,
        movement_type: "adjustment",
        quantity_base: diff,
        note: note.trim(),
      });
    } else if (mode === "waste") {
      await create.mutateAsync({
        raw_material_id: rawMaterial.id,
        movement_type: "waste",
        quantity_base: -Math.abs(numeric),
        note: note.trim(),
      });
    } else {
      await create.mutateAsync({
        raw_material_id: rawMaterial.id,
        movement_type: "opening",
        quantity_base: numeric,
        note: note.trim() || "Inngående beholdning",
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{TITLES[mode]}</DialogTitle>
          <DialogDescription>
            {rawMaterial.name}
            {mode === "opening"
              ? " — uten et startpunkt blir beholdningen bare differansen fra i dag og framover."
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {mode !== "opening" && (
            <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
              Systemet tror beholdningen er{" "}
              <span className="font-semibold tabular-nums">
                {formatNumber(rawMaterial.current_stock, 3)} {rawMaterial.base_unit}
              </span>
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label>
                {mode === "count" ? "Faktisk på hylla" : mode === "waste" ? "Antall som er kastet" : "Beholdning nå"}
              </Label>
              <Input
                value={value}
                onChange={e => setValue(e.target.value)}
                inputMode="decimal"
                autoFocus
                placeholder="0"
              />
            </div>
            <div className="w-[150px]">
              <Label className="text-xs">Enhet</Label>
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={BASE}>{rawMaterial.base_unit}</SelectItem>
                  {units.map(u => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.unit_label} ({formatNumber(u.units_in_base, 3)} {rawMaterial.base_unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedUnit && (
            <div>
              <Label className="text-xs">Løse {rawMaterial.base_unit} i tillegg (valgfritt)</Label>
              <Input value={extra} onChange={e => setExtra(e.target.value)} inputMode="decimal" placeholder="0" />
            </div>
          )}

          {valid && selectedUnit && (
            <p className="text-xs text-ink-secondary">
              Tilsvarer {formatNumber(numeric, 3)} {rawMaterial.base_unit}.
            </p>
          )}

          {mode === "count" && valid && (
            <div className="text-sm">
              Differanse:{" "}
              <span className={`font-semibold tabular-nums ${diff < 0 ? "text-destructive" : diff > 0 ? "text-success" : ""}`}>
                {diff > 0 ? "+" : ""}
                {formatNumber(diff, 3)} {rawMaterial.base_unit}
              </span>
              {diff === 0 && <span className="ml-2 text-ink-secondary">Ingen endring — ingen bevegelse lagres.</span>}
            </div>
          )}

          <div>
            <Label>Begrunnelse {noteRequired && "*"}</Label>
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder={
                mode === "waste" ? "Brekkasje, utgått vare …" : mode === "count" ? "Hvorfor avviker tellingen?" : "Valgfritt notat"
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={submit} disabled={!canSubmit}>Lagre</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
