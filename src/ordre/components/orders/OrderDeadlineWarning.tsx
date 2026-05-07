import { AlertTriangle, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { OrderDeadlineViolation } from "@/ordre/hooks/useOrderDeadlineCheck";

function formatHM(timestamp: string): string {
  const d = new Date(timestamp);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm} kl ${hh}:${min}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m > 0 ? `${h} t ${m} min` : `${h} t`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh > 0 ? `${d} d ${hh} t` : `${d} d`;
}

function minutesUntil(timestamp: string): number {
  return Math.round((new Date(timestamp).getTime() - Date.now()) / 60000);
}

export function OrderDeadlineWarning({
  violations,
}: {
  violations: OrderDeadlineViolation[];
}) {
  if (!violations || violations.length === 0) return null;

  const passed = violations.filter((v) => !v.is_passed === false || v.minutes_over > 0);
  // is_passed = true betyr "frist ikke passert ennå". minutes_over > 0 = passert.
  // Vi forenkler: bruk minutes_over > 0 som "passert".
  const passedFinal = violations.filter((v) => v.minutes_over > 0);
  const upcoming = violations.filter(
    (v) => v.minutes_over === 0 && minutesUntil(v.deadline_timestamp) <= 120 && minutesUntil(v.deadline_timestamp) >= 0,
  );

  if (passedFinal.length > 0) {
    return (
      <Card className="flex flex-wrap items-start gap-3 border-destructive/50 bg-destructive/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="flex-1 space-y-2">
          <div>
            <strong className="text-destructive">⛔ Ordrefrist passert</strong>
          </div>
          <ul className="space-y-1">
            {passedFinal.map((v) => (
              <li key={v.rule_id} className="flex flex-wrap items-baseline gap-1.5">
                <span className="font-medium">«{v.rule_name}»</span>
                <span className="text-muted-foreground">
                  — frist {formatHM(v.deadline_timestamp)}
                </span>
                <span className="text-destructive">
                  (passert for {formatDuration(v.minutes_over)})
                </span>
              </li>
            ))}
          </ul>
          {upcoming.length > 0 && (
            <ul className="space-y-1 border-t border-destructive/20 pt-2">
              {upcoming.map((v) => (
                <li key={v.rule_id} className="text-warning">
                  «{v.rule_name}» — frist om {formatDuration(minutesUntil(v.deadline_timestamp))}
                </li>
              ))}
            </ul>
          )}
          <div className="text-xs text-muted-foreground">
            Kan fortsatt registreres, men bør avklares med bakerisjef før bekreftelse.
          </div>
        </div>
      </Card>
    );
  }

  if (upcoming.length > 0) {
    return (
      <Card className="flex flex-wrap items-start gap-3 border-warning/50 bg-warning/10 p-3 text-sm">
        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <div className="flex-1 space-y-2">
          <div>
            <strong className="text-warning">⚠ Nært forestående ordrefrist</strong>
          </div>
          <ul className="space-y-1">
            {upcoming.map((v) => (
              <li key={v.rule_id} className="flex flex-wrap items-baseline gap-1.5">
                <span className="font-medium">«{v.rule_name}»</span>
                <span className="text-muted-foreground">
                  — frist {formatHM(v.deadline_timestamp)}
                </span>
                <span className="text-warning">
                  (om {formatDuration(minutesUntil(v.deadline_timestamp))})
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    );
  }

  return null;
}
