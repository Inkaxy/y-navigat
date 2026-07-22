// Diskret ⚠️-indikator på ordrelinjer i lister — vises hvis ordren har
// rule_flags (advarsler/info fra evaluate_delivery_rules) eller er lagret
// med en overstyrt block-regel. Tooltip forklarer treffene.

import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Flag = {
  rule_id?: string;
  rule_name?: string;
  effect?: "warn" | "info" | "block";
  message?: string;
};

type Props = {
  flags: unknown;
  overrideReason: string | null | undefined;
};

function parseFlags(x: unknown): Flag[] {
  if (Array.isArray(x)) return x as Flag[];
  return [];
}

export function OrderRuleFlagsIndicator({ flags, overrideReason }: Props) {
  const list = parseFlags(flags);
  if (list.length === 0 && !overrideReason) return null;

  const isOverride = !!overrideReason;
  const Icon = isOverride ? ShieldAlert : AlertTriangle;
  const cls = isOverride
    ? "text-destructive"
    : "text-amber-600 dark:text-amber-400";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex ${cls}`}
          aria-label={
            isOverride
              ? "Ordren er lagret med overstyrt leveringsregel"
              : `${list.length} leveringsregel-advarsler`
          }
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {isOverride && (
          <div className="mb-1 font-semibold text-destructive">
            Overstyrt: {overrideReason}
          </div>
        )}
        {list.length > 0 && (
          <ul className="space-y-1">
            {list.map((f, i) => (
              <li key={f.rule_id ?? i}>
                <span className="font-medium">{f.rule_name ?? "Regel"}:</span>{" "}
                {f.message ?? "—"}
              </li>
            ))}
          </ul>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
