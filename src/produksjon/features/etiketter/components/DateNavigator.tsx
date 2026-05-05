import { useMemo } from "react";
import { format, parseISO, differenceInCalendarDays, addDays } from "date-fns";
import { nb } from "date-fns/locale";
import { ChevronLeft, ChevronRight, CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Props {
  date: string; // YYYY-MM-DD
  onChange: (date: string) => void;
}

function toIso(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function relativeLabel(date: string): { text: string; tone: "future" | "past" | "today" } {
  const target = parseISO(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = differenceInCalendarDays(target, today);
  const weekday = format(target, "EEEE", { locale: nb });

  if (diff === 0) return { text: `i dag, ${weekday}`, tone: "today" };
  if (diff === 1) return { text: `i morgen, ${weekday}`, tone: "future" };
  if (diff === 2) return { text: `overmorgen, ${weekday}`, tone: "future" };
  if (diff > 2) return { text: `${weekday} om ${diff} dager`, tone: "future" };
  if (diff === -1) return { text: `i går, ${weekday}`, tone: "past" };
  return { text: `${weekday} for ${Math.abs(diff)} dager siden`, tone: "past" };
}

export function DateNavigator({ date, onChange }: Props) {
  const parsed = useMemo(() => parseISO(date), [date]);
  const rel = useMemo(() => relativeLabel(date), [date]);

  const shift = (days: number) => onChange(toIso(addDays(parsed, days)));

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Forrige dag"
          onClick={() => shift(-1)}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" className="text-2xl font-semibold tabular-nums">
              <CalendarIcon className="h-5 w-5 mr-2 opacity-60" />
              {format(parsed, "dd.MM.yyyy")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="center">
            <Calendar
              mode="single"
              selected={parsed}
              onSelect={(d) => d && onChange(toIso(d))}
              initialFocus
              locale={nb}
              weekStartsOn={1}
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Neste dag"
          onClick={() => shift(1)}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>
      <p
        className={cn(
          "text-sm font-medium",
          rel.tone === "future" && "text-app-primary",
          rel.tone === "today" && "text-app-primary",
          rel.tone === "past" && "text-muted-foreground",
        )}
      >
        {rel.text}
      </p>
    </div>
  );
}
