import { useState } from "react";
import { format, parseISO } from "date-fns";
import { nb } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  COMPARE_LABELS,
  ComparePreset,
  DateRange,
  PERIOD_PRESET_LABELS,
  PeriodPreset,
  rangeForPreset,
} from "@/ravarer/lib/periodPresets";
import { osloDateISO } from "@/lib/osloDate";

interface Props {
  preset: PeriodPreset;
  range: DateRange;
  compare: ComparePreset;
  customCompare?: DateRange | null;
  onPresetChange: (preset: PeriodPreset, range: DateRange) => void;
  onRangeChange: (range: DateRange) => void;
  onCompareChange: (compare: ComparePreset, customRange?: DateRange | null) => void;
  /** Skjul «Sammenlign med» der sammenligning ikke gir mening (f.eks. pristidslinjen). */
  showCompare?: boolean;
  className?: string;
}

function fmt(d: string) {
  try { return format(parseISO(d), "d. MMM yyyy", { locale: nb }); } catch { return d; }
}

export function PeriodPicker({
  preset, range, compare, customCompare,
  onPresetChange, onRangeChange, onCompareChange, showCompare = true, className,
}: Props) {
  const [openStart, setOpenStart] = useState(false);
  const [openEnd, setOpenEnd] = useState(false);
  const [openCmpStart, setOpenCmpStart] = useState(false);
  const [openCmpEnd, setOpenCmpEnd] = useState(false);

  const handlePreset = (p: PeriodPreset) => {
    if (p === "custom") {
      onPresetChange(p, range);
    } else {
      onPresetChange(p, rangeForPreset(p));
    }
  };

  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-ink-secondary">Periode</Label>
        <Select value={preset} onValueChange={(v) => handlePreset(v as PeriodPreset)}>
          <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PERIOD_PRESET_LABELS.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-end gap-2">
        <DateButton
          value={range.start} open={openStart} setOpen={setOpenStart}
          onChange={(d) => onRangeChange({ ...range, start: d })}
        />
        <span className="pb-2 text-ink-secondary">–</span>
        <DateButton
          value={range.end} open={openEnd} setOpen={setOpenEnd}
          onChange={(d) => onRangeChange({ ...range, end: d })}
        />
      </div>

      {showCompare && (
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-ink-secondary">Sammenlign med</Label>
          <Select
            value={compare}
            onValueChange={(v) => onCompareChange(v as ComparePreset, customCompare ?? null)}
          >
            <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COMPARE_LABELS.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {showCompare && compare === "custom" && (
        <div className="flex items-end gap-2">
          <DateButton
            value={customCompare?.start || range.start}
            open={openCmpStart} setOpen={setOpenCmpStart}
            onChange={(d) => onCompareChange("custom", { start: d, end: customCompare?.end || range.end })}
          />
          <span className="pb-2 text-ink-secondary">–</span>
          <DateButton
            value={customCompare?.end || range.end}
            open={openCmpEnd} setOpen={setOpenCmpEnd}
            onChange={(d) => onCompareChange("custom", { start: customCompare?.start || range.start, end: d })}
          />
        </div>
      )}
    </div>
  );
}

function DateButton({
  value, open, setOpen, onChange,
}: {
  value: string; open: boolean; setOpen: (b: boolean) => void; onChange: (iso: string) => void;
}) {
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 justify-start text-left font-normal">
          <CalendarIcon className="mr-2 h-3.5 w-3.5" />
          {fmt(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={parseISO(value)}
          onSelect={(d) => { if (d) { onChange(osloDateISO(d)); setOpen(false); } }}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}
