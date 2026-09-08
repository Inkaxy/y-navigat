/**
 * Tidslinje for oppskriftens prosess-steg — regner ut klokkeslett fortløpende
 * fra et valgt starttidspunkt. `buildTimeline` er en ren funksjon uten
 * side-effekter og er hjertet som testes; komponenten er bare visning.
 */
import { useState } from "react";
import { Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STEP_TYPE_LABEL, fmtDuration } from "@/varer/lib/bakers";

export interface TimelineStepInput {
  id: string;
  step_type: string | null;
  title: string | null;
  duration_minutes: number | string | null;
}

export interface TimelineInput {
  /** Klokkeslett «HH:mm» som første steg starter på. */
  startTime: string;
  steps: TimelineStepInput[];
  /** Fra oppskriftshodet — vises som egne steg FØRST, uten datamigrering. */
  header?: {
    autolyse_minutes?: number | string | null;
    mixing_speed1_minutes?: number | string | null;
    mixing_speed2_minutes?: number | string | null;
  };
}

export interface TimelineRow {
  id: string;
  /** Norsk etikett. */
  label: string;
  minutes: number;
  /** «HH:mm» start og slutt. */
  startsAt: string;
  endsAt: string;
  /** Sann for de avledede hodefeltene (autolyse/elting), som ikke er lagrede steg. */
  derived: boolean;
}

const DEFAULT_START = "08:00";
const VALID_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseStartTime(startTime: string): number {
  const m = VALID_TIME_RE.exec((startTime ?? "").trim());
  if (!m) return parseStartTime(DEFAULT_START);
  return Number(m[1]) * 60 + Number(m[2]);
}

function fmtClock(totalMinutes: number): string {
  const m = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `${String(h).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function toMinutes(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function stepLabel(step: TimelineStepInput): string {
  if (step.title) return step.title;
  if (step.step_type && STEP_TYPE_LABEL[step.step_type]) return STEP_TYPE_LABEL[step.step_type];
  return "Steg";
}

/**
 * Bygger tidslinjeradene fra starttidspunkt, hodefelt og lagrede steg.
 * Ren funksjon — ingen side-effekter, testbar isolert.
 */
export function buildTimeline(input: TimelineInput): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let cursor = parseStartTime(input.startTime);

  function push(id: string, label: string, minutes: number, derived: boolean) {
    const startsAt = fmtClock(cursor);
    cursor += minutes;
    const endsAt = fmtClock(cursor);
    rows.push({ id, label, minutes, startsAt, endsAt, derived });
  }

  const header = input.header;
  if (header) {
    const autolyse = toMinutes(header.autolyse_minutes);
    if (autolyse > 0) push("derived-autolyse", "Autolyse", autolyse, true);
    const mix1 = toMinutes(header.mixing_speed1_minutes);
    if (mix1 > 0) push("derived-mix1", "Elting 1. gir", mix1, true);
    const mix2 = toMinutes(header.mixing_speed2_minutes);
    if (mix2 > 0) push("derived-mix2", "Elting 2. gir", mix2, true);
  }

  for (const step of input.steps) {
    push(step.id, stepLabel(step), toMinutes(step.duration_minutes), false);
  }

  return rows;
}

/** Summerer alle radenes varighet. */
export function totalMinutes(rows: TimelineRow[]): number {
  return rows.reduce((sum, r) => sum + r.minutes, 0);
}

export function StepTimeline({
  steps,
  header,
  className,
}: {
  steps: TimelineStepInput[];
  header?: TimelineInput["header"];
  className?: string;
}) {
  const [startTime, setStartTime] = useState(DEFAULT_START);
  const rows = buildTimeline({ startTime, steps, header });
  const total = totalMinutes(rows);
  const finishedAt = rows.length ? rows[rows.length - 1].endsAt : startTime;

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4 text-app" /> Tidslinje
        </CardTitle>
        <div className="flex items-center gap-2">
          <label htmlFor="timeline-start" className="text-xs text-muted-foreground">
            Start
          </label>
          <Input
            id="timeline-start"
            type="time"
            className="h-8 w-28"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
            Ingen prosesstrinn med varighet ennå.
          </div>
        ) : (
          <>
            <ul className="space-y-1.5">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border px-2 py-1.5 text-sm"
                >
                  <span className="tabular-nums text-muted-foreground">{row.startsAt}</span>
                  <span className={cn("font-medium", row.derived && "text-muted-foreground")}>{row.label}</span>
                  {row.derived && (
                    <Badge variant="outline" className="text-[10px] font-normal">
                      Fra oppskriftsinfo
                    </Badge>
                  )}
                  <span className="ml-auto tabular-nums text-muted-foreground">{fmtDuration(row.minutes)}</span>
                </li>
              ))}
            </ul>
            <div className="pt-1 text-xs text-muted-foreground">
              Ferdig ca. {finishedAt} · total {fmtDuration(total)}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
