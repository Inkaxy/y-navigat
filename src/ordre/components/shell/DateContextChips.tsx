import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { todayISO, tomorrow, formatDateLong } from "@/lib/format";
import { rangeFor } from "@/lib/dateRanges";
import { relativeDateLabel } from "@/lib/relativeDate";

export type DateChipKind = "today" | "tomorrow" | "this_week" | "next_week";

const CHIPS: { kind: DateChipKind; label: string }[] = [
  { kind: "today", label: "I dag" },
  { kind: "tomorrow", label: "I morgen" },
  { kind: "this_week", label: "Denne uken" },
  { kind: "next_week", label: "Neste uken" },
];

function dateForChip(kind: DateChipKind): string {
  if (kind === "today") return todayISO();
  if (kind === "tomorrow") return tomorrow();
  return rangeFor(kind === "this_week" ? "this_week" : "next_week").from;
}

function chipMatches(kind: DateChipKind, date: string): boolean {
  if (kind === "today") return date === todayISO();
  if (kind === "tomorrow") return date === tomorrow();
  const r = rangeFor(kind === "this_week" ? "this_week" : "next_week");
  return date >= r.from && date <= r.to;
}

/**
 * DateContextChips — hurtig dato-chips + sentrert dato med relativ tekst.
 * Brukes i header på operative sider (Dashbord, Pakksedler, Matrise).
 *
 * A.5.5.6 STEG 2.3
 */
export function DateContextChips({
  date,
  onChange,
  className,
}: {
  /** Aktiv dato (YYYY-MM-DD) */
  date: string;
  onChange: (date: string) => void;
  className?: string;
}) {
  let safeRelative = "";
  try {
    safeRelative = relativeDateLabel(date).label;
  } catch {
    safeRelative = "";
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <div className="flex flex-wrap gap-1">
        {CHIPS.map((c) => {
          const active = chipMatches(c.kind, date);
          return (
            <Button
              key={c.kind}
              size="sm"
              variant={active ? "default" : "outline"}
              className="h-7 px-2.5 text-caption"
              onClick={() => onChange(dateForChip(c.kind))}
            >
              {c.label}
            </Button>
          );
        })}
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-body font-medium text-foreground">{formatDateLong(date)}</span>
        {safeRelative && (
          <span className="text-caption text-muted-foreground">{safeRelative}</span>
        )}
      </div>
    </div>
  );
}
