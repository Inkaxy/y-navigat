import { useMemo, useState } from "react";
import { CalendarRange, Calendar as CalendarIcon } from "lucide-react";
import { format as fmt, addWeeks, startOfWeek, endOfWeek, getISOWeek, startOfMonth, endOfMonth, eachWeekOfInterval } from "date-fns";
import { nb } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Props {
  /** Aktiv ISO-dato (YYYY-MM-DD) */
  date: string;
  onChange: (date: string) => void;
  /** Hvor mange uker som listes (default: alle ukene i måneden + 1 etter) */
  weeksAhead?: number;
  className?: string;
}

/**
 * Kompakt par av kvikkvalg-knapper:
 *  - CalendarRange: liste av ukene i nåværende måned, klikk = mandag i uken
 *  - Calendar: shadcn-Calendar for fri datovalg
 *
 * Samme høyde som <Button size="icon"> for å holde linje med pil-knappene.
 */
export function WeekMonthQuickPicker({ date, onChange, className }: Props) {
  const [weekOpen, setWeekOpen] = useState(false);
  const [monthOpen, setMonthOpen] = useState(false);

  const current = useMemo(() => new Date(date + "T12:00:00"), [date]);

  // Liste av uker i nåværende kalendermåned (mandag-start)
  const weeks = useMemo(() => {
    const monthStart = startOfMonth(current);
    const monthEnd = endOfMonth(current);
    const starts = eachWeekOfInterval({ start: monthStart, end: monthEnd }, { weekStartsOn: 1 });
    return starts.map((monday) => {
      const sunday = endOfWeek(monday, { weekStartsOn: 1 });
      return {
        weekNumber: getISOWeek(monday),
        monday,
        sunday,
        iso: fmt(monday, "yyyy-MM-dd"),
      };
    });
  }, [current]);

  const activeWeek = getISOWeek(current);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {/* Uke-velger */}
      <Popover open={weekOpen} onOpenChange={setWeekOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="Velg uke"
            title="Velg uke"
          >
            <CalendarRange className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <div className="border-b px-3 py-2 text-sm text-muted-foreground">
            Uker i {fmt(current, "MMMM yyyy", { locale: nb })}
          </div>
          <ul className="max-h-72 overflow-y-auto p-1">
            {weeks.map((w) => {
              const isActive = w.weekNumber === activeWeek;
              return (
                <li key={w.iso}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(w.iso);
                      setWeekOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted",
                    )}
                  >
                    <span className="font-medium">Uke {w.weekNumber}</span>
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        isActive ? "text-primary-foreground/85" : "text-muted-foreground",
                      )}
                    >
                      {fmt(w.monday, "d.", { locale: nb })}–{fmt(w.sunday, "d. MMM", { locale: nb })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>

      {/* Måned-velger (fri dato) */}
      <Popover open={monthOpen} onOpenChange={setMonthOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="Velg dato i kalender"
            title="Velg dato i kalender"
          >
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            locale={nb}
            selected={current}
            onSelect={(d) => {
              if (d) {
                onChange(fmt(d, "yyyy-MM-dd"));
                setMonthOpen(false);
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
