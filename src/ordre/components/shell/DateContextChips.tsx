import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { todayISO, tomorrow, formatDateLong } from "@/ordre/lib/format";
import { rangeFor } from "@/ordre/lib/dateRanges";
import { relativeDateLabel } from "@/ordre/lib/relativeDate";

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
 * DateContextChips — "tape-tabs": etikett-typografi (uppercase, spor),
 * aktiv chip i bronze på cream, inaktiv outline.
 */
export function DateContextChips({
  date,
  onChange,
  className,
}: {
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
      <div className="flex flex-wrap gap-1.5">
        {CHIPS.map((c) => {
          const active = chipMatches(c.kind, date);
          return (
            <Button
              key={c.kind}
              size="sm"
              variant={active ? "brand" : "outline"}
              className={cn(
                "h-7 rounded-[8px] px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em]",
                !active && "border-brand-bronze/30 text-brand-bronze hover:bg-brand-bronze/5",
              )}
              onClick={() => onChange(dateForChip(c.kind))}
            >
              {c.label}
            </Button>
          );
        })}
      </div>
      <div className="flex flex-col leading-tight">
        <span className="font-display text-base font-semibold tracking-tight text-foreground">
          {formatDateLong(date)}
        </span>
        {safeRelative && (
          <span className="text-[11px] uppercase tracking-[0.18em] text-brand-bronze/80">
            {safeRelative}
          </span>
        )}
      </div>
    </div>
  );
}
