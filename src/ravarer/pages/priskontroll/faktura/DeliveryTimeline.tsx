import { Flag } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DeliveryStep } from "./invoiceSteps";

type Props = {
  steps: DeliveryStep[];
  flagged?: boolean;
  creditNote?: boolean;
  /** Vis etikett for siste fullførte steg ved siden av prikkene. */
  showLabel?: boolean;
  className?: string;
};

/** Liten horisontal stegindikator: Mottatt → Linjer lest → Kontrollert → Avstemt → Godkjent → Kostpris ført. */
export function DeliveryTimeline({ steps, flagged, creditNote, showLabel, className }: Props) {
  const last = [...steps].reverse().find((s) => s.done && !s.na);
  const summary = steps.map((s) => `${s.label}: ${s.na ? "ikke relevant" : s.done ? "ja" : "nei"}`).join(", ");
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <ol className="flex items-center" aria-label={`Leveransestatus. ${summary}`}>
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center">
            {i > 0 && <span aria-hidden className={cn("h-px w-2.5", s.done ? "bg-success" : "bg-border")} />}
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  aria-label={`${s.label}: ${s.detail}`}
                  className={cn(
                    "block h-2.5 w-2.5 rounded-full border",
                    s.na ? "border-dashed border-ink-secondary bg-background" : s.done ? "border-success bg-success" : "border-border bg-background",
                  )}
                />
              </TooltipTrigger>
              <TooltipContent>
                <span className="font-medium">{s.label}</span> · {s.detail}
              </TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ol>
      {showLabel && last && <span className="whitespace-nowrap text-caption text-ink-secondary">{last.label}</span>}
      {flagged && (
        <span className="inline-flex items-center gap-1 text-caption text-warning">
          <Flag className="h-3 w-3" aria-hidden />Flagget
        </span>
      )}
      {creditNote && <span className="text-caption text-warning">Kreditnota</span>}
    </div>
  );
}
