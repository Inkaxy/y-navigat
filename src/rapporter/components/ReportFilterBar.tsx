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
import { osloDateISO } from "@/lib/osloDate";
import {
  COMPARE_LABELS,
  PERIOD_PRESET_LABELS,
  rangeForPreset,
  type ComparePreset,
  type DateRange,
  type PeriodPreset,
} from "@/rapporter/lib/periods";
import {
  DIMENSION_LABELS,
  useCustomerProfileOptions,
  useStatisticGroupOptions,
  type SalesDimension,
} from "@/rapporter/hooks/useSalesAggregate";

export const ALL = "__all__";

export function DateField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (iso: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  let display = value;
  try {
    display = format(parseISO(value), "d. MMM yyyy", { locale: nb });
  } catch {
    /* behold rå verdi */
  }
  return (
    <div className="flex flex-col gap-1">
      {label ? <Label className="text-xs text-muted-foreground">{label}</Label> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-9 justify-start text-left font-normal">
            <CalendarIcon className="mr-2 h-3.5 w-3.5" />
            {display}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value ? parseISO(value) : undefined}
            onSelect={(d) => {
              if (d) {
                onChange(osloDateISO(d));
                setOpen(false);
              }
            }}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export interface ReportFilterBarProps {
  preset: PeriodPreset;
  range: DateRange;
  onPresetChange: (p: PeriodPreset, r: DateRange) => void;
  onRangeChange: (r: DateRange) => void;

  compare?: ComparePreset;
  onCompareChange?: (c: ComparePreset) => void;

  dimension?: SalesDimension;
  onDimensionChange?: (d: SalesDimension) => void;

  profileId?: string | null;
  onProfileChange?: (id: string | null) => void;

  groupId?: string | null;
  onGroupChange?: (id: string | null) => void;

  actions?: React.ReactNode;
  className?: string;
}

export function ReportFilterBar({
  preset,
  range,
  onPresetChange,
  onRangeChange,
  compare,
  onCompareChange,
  dimension,
  onDimensionChange,
  profileId,
  onProfileChange,
  groupId,
  onGroupChange,
  actions,
  className,
}: ReportFilterBarProps) {
  const { data: profiles } = useCustomerProfileOptions();
  const { data: groups } = useStatisticGroupOptions();

  return (
    <div className={cn("flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4", className)}>
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Periode</Label>
        <Select
          value={preset}
          onValueChange={(v) => {
            const p = v as PeriodPreset;
            onPresetChange(p, p === "custom" ? range : rangeForPreset(p));
          }}
        >
          <SelectTrigger className="h-9 w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_PRESET_LABELS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-end gap-2">
        <DateField value={range.start} onChange={(d) => onRangeChange({ ...range, start: d })} label="Fra" />
        <DateField value={range.end} onChange={(d) => onRangeChange({ ...range, end: d })} label="Til" />
      </div>

      {compare && onCompareChange ? (
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Sammenlign med</Label>
          <Select value={compare} onValueChange={(v) => onCompareChange(v as ComparePreset)}>
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPARE_LABELS.filter((c) => c.value !== "custom").map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {dimension && onDimensionChange ? (
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Grupper på</Label>
          <Select value={dimension} onValueChange={(v) => onDimensionChange(v as SalesDimension)}>
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIMENSION_LABELS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {onProfileChange ? (
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Kundeprofil</Label>
          <Select
            value={profileId ?? ALL}
            onValueChange={(v) => onProfileChange(v === ALL ? null : v)}
          >
            <SelectTrigger className="h-9 w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle kundeprofiler</SelectItem>
              {(profiles ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {onGroupChange ? (
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Statistikkgruppe</Label>
          <Select value={groupId ?? ALL} onValueChange={(v) => onGroupChange(v === ALL ? null : v)}>
            <SelectTrigger className="h-9 w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle grupper</SelectItem>
              {(groups ?? []).map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {actions ? <div className="ml-auto flex items-end gap-2">{actions}</div> : null}
    </div>
  );
}
