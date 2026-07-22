// Live-visning av leveringsregel-treff i ordreflatene.
// Rød boks for 'block', gul for 'warn', diskret grå notis for 'info'.

import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeliveryRuleHit } from "@/ordre/hooks/usePreviewDeliveryRules";

type Props = {
  blocks: DeliveryRuleHit[];
  warns: DeliveryRuleHit[];
  infos: DeliveryRuleHit[];
  /** Ekstra melding under blokk-listen (f.eks. «kontakt ordrekontoret»). */
  blockedHint?: string;
  className?: string;
  compact?: boolean;
};

function HitList({ hits }: { hits: DeliveryRuleHit[] }) {
  return (
    <ul className="space-y-1.5">
      {hits.map((h) => (
        <li key={h.rule_id} className="text-sm leading-snug">
          <span className="font-semibold">«{h.rule_name}»</span>
          {typeof h.priority === "number" && (
            <span className="ml-1 text-xs text-muted-foreground">
              (prioritet {h.priority})
            </span>
          )}
          <div className="mt-0.5 text-sm">{h.message}</div>
        </li>
      ))}
    </ul>
  );
}

export function DeliveryRulesFeedback({
  blocks,
  warns,
  infos,
  blockedHint,
  className,
  compact = false,
}: Props) {
  if (blocks.length === 0 && warns.length === 0 && infos.length === 0) return null;

  return (
    <div className={cn("space-y-2", className)}>
      {blocks.length > 0 && (
        <div
          className={cn(
            "flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3",
            compact && "p-2",
          )}
          role="alert"
        >
          <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="text-sm font-semibold text-destructive">
              {blocks.length === 1
                ? "Leveringsregel blokkerer ordren"
                : `${blocks.length} leveringsregler blokkerer ordren`}
            </div>
            <HitList hits={blocks} />
            {blockedHint && (
              <div className="pt-1 text-xs text-muted-foreground">{blockedHint}</div>
            )}
          </div>
        </div>
      )}

      {warns.length > 0 && (
        <div
          className={cn(
            "flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3",
            compact && "p-2",
          )}
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {warns.length === 1 ? "Advarsel" : `${warns.length} advarsler`}
            </div>
            <HitList hits={warns} />
          </div>
        </div>
      )}

      {infos.length > 0 && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground",
            compact && "py-1.5",
          )}
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            {infos.map((h) => (
              <div key={h.rule_id}>
                <span className="font-medium">{h.rule_name}:</span> {h.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
