import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateStockMovement } from "@/ravarer/hooks/useStock";
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

export function StockAdjustDialog({ open, onOpenChange, mode, rawMaterial }: Props) {
  const create = useCreateStockMovement();
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setValue("");
      setNote("");
    }
  }, [open, rawMaterial?.id, mode]);

  if (!rawMaterial) return null;

  const numeric = Number(String(value).replace(",", "."));
  const valid = value.trim() !== "" && Number.isFinite(numeric);
  const diff = mode === "count" ? numeric - rawMaterial.current_stock : 0;
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

          <div>
            <Label>
              {mode === "count"
                ? "Faktisk på hylla"
                : mode === "waste"
                  ? "Antall som er kastet"
                  : "Beholdning nå"}{" "}
              ({rawMaterial.base_unit})
            </Label>
            <Input
              value={value}
              onChange={e => setValue(e.target.value)}
              inputMode="decimal"
              autoFocus
              placeholder="0"
            />
          </div>

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
