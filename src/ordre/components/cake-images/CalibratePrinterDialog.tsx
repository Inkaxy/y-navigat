import { useEffect, useMemo, useState } from "react";
import { Ruler } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CALIBRATION_MM, printCalibrationSheet } from "@/ordre/lib/cakePrint";
import {
  correctionPct,
  correctionSentence,
  useCakeCalibrations,
  useCakePrinterSelection,
  useSaveCakeCalibration,
} from "@/ordre/hooks/useCakeCalibration";

/**
 * Kalibrering per skriver. Vi skriver ut et kvadrat på 100 × 100 mm, brukeren
 * måler det med linjal i begge retninger, og korreksjonen
 * `target_mm / measured_mm × 100` lagres i prosent.
 */
export function CalibratePrinterDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: calibrations = [] } = useCakeCalibrations();
  const { printerLabel, selectPrinter } = useCakePrinterSelection();
  const save = useSaveCakeCalibration();
  const [printer, setPrinter] = useState("");
  const [measuredX, setMeasuredX] = useState("");
  const [measuredY, setMeasuredY] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) setPrinter(printerLabel ?? "");
  }, [open, printerLabel]);

  const parse = (v: string) => Number(v.replace(",", "."));
  const mx = parse(measuredX);
  const my = parse(measuredY);

  const preview = useMemo(() => {
    const rows: Array<{ label: string; pct: number; measured: number }> = [];
    if (Number.isFinite(mx) && mx > 0)
      rows.push({ label: "Bredde", pct: correctionPct(CALIBRATION_MM, mx), measured: mx });
    if (Number.isFinite(my) && my > 0)
      rows.push({ label: "Høyde", pct: correctionPct(CALIBRATION_MM, my), measured: my });
    return rows;
  }, [mx, my]);

  const printTestSheet = async () => {
    try {
      await printCalibrationSheet(printer.trim() || printerLabel || null);
    } catch (e) {
      console.error("[CalibratePrinterDialog] kunne ikke skrive ut testarket", e);
      toast.error("Kunne ikke starte utskriften av testarket");
    }
  };

  const onSave = async () => {
    if (!printer.trim()) {
      toast.error("Gi skriveren et navn");
      return;
    }
    if (!Number.isFinite(mx) || mx <= 0 || !Number.isFinite(my) || my <= 0) {
      toast.error("Fyll inn hva du målte i begge retninger");
      return;
    }
    if (
      Math.abs(mx - CALIBRATION_MM) / CALIBRATION_MM > 0.15 ||
      Math.abs(my - CALIBRATION_MM) / CALIBRATION_MM > 0.15
    ) {
      toast.error("Målet avviker mer enn 15 % — kontroller at du målte kvadratet");
      return;
    }
    const res = await save.mutateAsync({
      printer_label: printer.trim(),
      target_mm: CALIBRATION_MM,
      measured_x_mm: mx,
      measured_y_mm: my,
      is_default: isDefault,
      note: note.trim() || null,
    });
    selectPrinter(printer.trim());
    toast.success(
      `Kalibrering lagret: ${res.scale_x_pct} % × ${res.scale_y_pct} %`,
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ruler className="h-4 w-4" />
            Kalibrer skriver
          </DialogTitle>
          <DialogDescription>
            Skriv ut testarket, mål kvadratet med linjal og skriv inn hva du
            faktisk målte. Utskriftene korrigeres deretter automatisk.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cal-printer">Skriver</Label>
            <Input
              id="cal-printer"
              value={printer}
              onChange={(e) => setPrinter(e.target.value)}
              placeholder="F.eks. Epson konditori"
            />
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => void printTestSheet()}
          >
            Skriv ut testark ({CALIBRATION_MM} × {CALIBRATION_MM} mm + 50 mm skala)
          </Button>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cal-x">Målt bredde (mm)</Label>
              <Input
                id="cal-x"
                inputMode="decimal"
                value={measuredX}
                onChange={(e) => setMeasuredX(e.target.value)}
                placeholder={String(CALIBRATION_MM)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cal-y">Målt høyde (mm)</Label>
              <Input
                id="cal-y"
                inputMode="decimal"
                value={measuredY}
                onChange={(e) => setMeasuredY(e.target.value)}
                placeholder={String(CALIBRATION_MM)}
              />
            </div>
          </div>

          {preview.length > 0 && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              {preview.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between">
                  <span className="text-muted-foreground">
                    {r.label}: målt {r.measured.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} mm av {CALIBRATION_MM} mm
                  </span>
                  <span className="font-semibold tabular-nums">
                    {r.pct.toLocaleString("nb-NO", { maximumFractionDigits: 2 })} %
                  </span>
                </div>
              ))}
              <p className="mt-2 text-xs text-muted-foreground">
                {correctionSentence(preview[0].pct)}
              </p>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="cal-default" className="text-sm">
                Standardskriver
              </Label>
              <p className="text-xs text-muted-foreground">
                Velges automatisk på nye maskiner.
              </p>
            </div>
            <Switch id="cal-default" checked={isDefault} onCheckedChange={setIsDefault} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cal-note">Merknad</Label>
            <Textarea
              id="cal-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="F.eks. hvilket papir og hvilken driverinnstilling som ble brukt"
            />
          </div>

          {calibrations.length > 0 && (
            <div className="rounded-lg border bg-muted/40 p-2 text-xs">
              <div className="mb-1 font-semibold">Lagrede kalibreringer</div>
              <ul className="space-y-0.5 text-muted-foreground">
                {calibrations.map((c) => (
                  <li key={c.id}>
                    {c.printer_label}: {c.scale_x_pct} % × {c.scale_y_pct} %
                    {c.is_default ? " (standard)" : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button onClick={() => void onSave()} disabled={save.isPending}>
            Lagre kalibrering
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
