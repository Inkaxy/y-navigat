import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";
import type { MatrixTour } from "@/ordre/hooks/useMatrix";
import { tourActiveOnDate, addDays } from "@/ordre/hooks/useMatrix";

export type CopyColumnInput = {
  targetDate: string;
  targetTourId: string;
  includeMerknad: boolean;
  mode: "overwrite" | "sum";
};

export function CopyColumnDialog({
  open,
  onOpenChange,
  sourceDate,
  sourceTour,
  visibleDates,
  tours,
  targetHasData,
  onConfirm,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sourceDate: string;
  sourceTour: MatrixTour;
  visibleDates: string[];
  tours: MatrixTour[];
  /** Funksjon som sier om mål-kolonnen har eksisterende data — kalles på endring */
  targetHasData: (date: string, tourId: string) => boolean;
  onConfirm: (input: CopyColumnInput) => Promise<void> | void;
  isSaving: boolean;
}) {
  const defaultDate = useMemo(() => {
    const next = addDays(sourceDate, 1);
    return visibleDates.includes(next) && tourActiveOnDate(sourceTour, next)
      ? next
      : visibleDates.find((d) => d !== sourceDate && tourActiveOnDate(sourceTour, d)) ?? sourceDate;
  }, [sourceDate, sourceTour, visibleDates]);

  const [targetDate, setTargetDate] = useState(defaultDate);
  const [targetTourId, setTargetTourId] = useState(sourceTour.id);
  const [includeMerknad, setIncludeMerknad] = useState(false);
  const [mode, setMode] = useState<"overwrite" | "sum">("overwrite");

  useEffect(() => {
    if (open) {
      setTargetDate(defaultDate);
      setTargetTourId(sourceTour.id);
      setIncludeMerknad(false);
      setMode("overwrite");
    }
  }, [open, defaultDate, sourceTour.id]);

  const eligibleTours = tours.filter((t) => tourActiveOnDate(t, targetDate));
  const conflict = targetHasData(targetDate, targetTourId);
  const sameAsSource = targetDate === sourceDate && targetTourId === sourceTour.id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kopier kolonne</DialogTitle>
          <DialogDescription>
            Fra {sourceDate} · T{sourceTour.tour_number} {sourceTour.display_name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Mål-dato</Label>
            <Select value={targetDate} onValueChange={setTargetDate}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {visibleDates.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Mål-tur</Label>
            <Select
              value={eligibleTours.some((t) => t.id === targetTourId) ? targetTourId : ""}
              onValueChange={setTargetTourId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Velg tur …" />
              </SelectTrigger>
              <SelectContent>
                {eligibleTours.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    T{t.tour_number} — {t.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {eligibleTours.length === 0 && (
              <p className="text-xs text-destructive">Ingen aktive turer på valgt dato.</p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="incl-merknad" className="text-sm">Inkluder merknader</Label>
            <Switch id="incl-merknad" checked={includeMerknad} onCheckedChange={setIncludeMerknad} />
          </div>

          {conflict && (
            <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
              <p className="text-sm font-medium">Mål-kolonnen har eksisterende ordrer.</p>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as "overwrite" | "sum")}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="overwrite" id="m-ow" />
                  <Label htmlFor="m-ow" className="font-normal">Overskriv eksisterende</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="sum" id="m-sum" />
                  <Label htmlFor="m-sum" className="font-normal">Summer (legg til)</Label>
                </div>
              </RadioGroup>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>Avbryt</Button>
          <Button
            onClick={() => onConfirm({ targetDate, targetTourId, includeMerknad, mode })}
            disabled={isSaving || sameAsSource || !targetTourId || eligibleTours.length === 0}
          >
            {isSaving && <Loader2 className="animate-spin" />}
            Kopier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
