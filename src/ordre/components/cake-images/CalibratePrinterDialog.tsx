import { useState } from "react";
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
import {
  CALIBRATION_MM,
  CAKE_PRINT_CSS,
  calibrationSheetHtml,
} from "@/ordre/lib/cakePrint";
import {
  useCakeCalibrations,
  useSaveCakeCalibration,
} from "@/ordre/hooks/useCakeCalibration";

/**
 * Kalibrering per skriver. Vi skriver ut et kvadrat på 100 mm, brukeren måler
 * det med linjal, og korreksjonsfaktoren lagres slik at 200 mm faktisk blir
 * 200 mm på sukkerpapiret.
 */
export function CalibratePrinterDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: calibrations = [] } = useCakeCalibrations();
  const save = useSaveCakeCalibration();
  const [printer, setPrinter] = useState("Standardskriver");
  const [measured, setMeasured] = useState("");

  const printTestSheet = () => {
    const w = window.open("", "_blank", "width=900,height=1100");
    if (!w) {
      toast.error("Nettleseren blokkerte utskriftsvinduet");
      return;
    }
    const style = w.document.createElement("style");
    style.textContent = CAKE_PRINT_CSS;
    w.document.head.appendChild(style);
    w.document.body.appendChild(calibrationSheetHtml(w.document));
    w.focus();
    w.print();
  };

  const onSave = async () => {
    const m = Number(measured.replace(",", "."));
    if (!printer.trim() || !Number.isFinite(m) || m <= 0) {
      toast.error("Fyll inn skrivernavn og målt lengde");
      return;
    }
    if (Math.abs(m - CALIBRATION_MM) / CALIBRATION_MM > 0.15) {
      toast.error("Målet avviker mer enn 15 % — kontroller at du målte kvadratet");
      return;
    }
    const factor = await save.mutateAsync({
      printer_name: printer.trim(),
      expected_mm: CALIBRATION_MM,
      measured_mm: m,
    });
    toast.success(`Korreksjonsfaktor lagret: ×${Math.round(factor * 10000) / 10000}`);
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
          <Button variant="outline" className="w-full" onClick={printTestSheet}>
            Skriv ut testark ({CALIBRATION_MM} × {CALIBRATION_MM} mm)
          </Button>
          <div className="space-y-1.5">
            <Label htmlFor="cal-printer">Skriver</Label>
            <Input
              id="cal-printer"
              value={printer}
              onChange={(e) => setPrinter(e.target.value)}
              placeholder="F.eks. Epson konditori"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cal-measured">Målt lengde (mm)</Label>
            <Input
              id="cal-measured"
              inputMode="decimal"
              value={measured}
              onChange={(e) => setMeasured(e.target.value)}
              placeholder={String(CALIBRATION_MM)}
            />
          </div>

          {calibrations.length > 0 && (
            <div className="rounded-lg border bg-muted/40 p-2 text-xs">
              <div className="mb-1 font-semibold">Lagrede kalibreringer</div>
              <ul className="space-y-0.5 text-muted-foreground">
                {calibrations.map((c) => (
                  <li key={c.id}>
                    {c.printer_name}: målt {c.measured_mm} mm → ×{c.scale_factor}
                    {c.is_active ? " (aktiv)" : ""}
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
