import { Fragment } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { getStatusMeta, type OrderStatus } from "@/ordre/lib/orderStatus";
import { MAIN_FLOW, SIDE_BRANCHES, flowIndex } from "@/ordre/lib/statusTransitions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { OrderEvent } from "@/ordre/hooks/useOrderDetail";
import { formatDateTime } from "@/ordre/lib/format";
import { StatusBadge } from "./StatusBadge";

export function StatusFlowBar({
  current,
  events,
  userNames,
  source,
}: {
  current: OrderStatus;
  events: OrderEvent[];
  userNames: Record<string, string>;
  /** Order-source — interne ordre (manual/matrix_entry) hopper over "Utkast" */
  source?: string;
}) {
  const currentIdx = flowIndex(current);
  const isOnSide = currentIdx === -1;
  const isInternal = source === "manual" || source === "matrix_entry";

  // Map: status → tidspunkt + bruker (for hovedflyt)
  const passedAt = new Map<string, OrderEvent>();
  for (const ev of [...events].reverse()) {
    if (!passedAt.has(ev.to_status)) passedAt.set(ev.to_status, ev);
  }

  const visibleSide = SIDE_BRANCHES.filter((s) => current === s || passedAt.has(s));

  return (
    <div className="space-y-4">
      {/* Hovedflyt */}
      <div className="overflow-x-auto pb-2">
        <ol className="flex min-w-max items-center gap-1 sm:gap-2">
          {MAIN_FLOW.map((status, i) => {
            const meta = getStatusMeta(status);
            const isCurrent = current === status;
            const isPassed = currentIdx > i;
            const isSkipped = isInternal && status === "draft" && current !== "draft";
            const ev = passedAt.get(status);
            const dotStyle = !isSkipped && (isCurrent || isPassed)
              ? { backgroundColor: `hsl(var(${meta.tokenVar}))`, color: "hsl(var(--primary-foreground))" }
              : undefined;

            return (
              <Fragment key={status}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <li
                      className={cn(
                        "flex min-w-[88px] flex-col items-center gap-1.5 rounded-md px-2 py-1.5 text-center transition-colors",
                        isCurrent && "ring-2 ring-offset-2 ring-offset-background",
                        isSkipped && "opacity-50",
                      )}
                      style={isCurrent ? { boxShadow: `0 0 0 2px hsl(var(${meta.tokenVar}))` } : undefined}
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold",
                          ((!isPassed && !isCurrent) || isSkipped) && "border-dashed border-border bg-muted text-muted-foreground",
                        )}
                        style={dotStyle}
                      >
                        {isSkipped ? "–" : isPassed ? <Check className="h-3.5 w-3.5" /> : i + 1}
                      </span>
                      <span
                        className={cn(
                          "text-xs font-medium",
                          isSkipped && "italic text-muted-foreground line-through",
                          !isSkipped && (isCurrent || isPassed) ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {meta.label}
                      </span>
                    </li>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {isSkipped ? (
                      <span className="text-xs text-muted-foreground">Hoppet over — interne ordre starter som «Bekreftet»</span>
                    ) : ev ? (
                      <div className="text-xs">
                        <div>{formatDateTime(ev.changed_at)}</div>
                        {ev.changed_by && (
                          <div className="text-muted-foreground">
                            {userNames[ev.changed_by] ?? "Ukjent"}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Ikke nådd</span>
                    )}
                  </TooltipContent>
                </Tooltip>
                {i < MAIN_FLOW.length - 1 && (
                  <div
                    className={cn(
                      "h-0.5 w-4 flex-shrink-0 sm:w-8",
                      currentIdx > i ? "bg-foreground/40" : "bg-border",
                    )}
                  />
                )}
              </Fragment>
            );
          })}
        </ol>
      </div>

      {/* Sidegrener */}
      {(visibleSide.length > 0 || isOnSide) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">Sidegrener:</span>
          {visibleSide.map((status) => (
            <StatusBadge key={status} status={status} className={current === status ? "ring-2 ring-foreground/20" : ""} />
          ))}
          {visibleSide.length === 0 && (
            <span className="text-xs italic text-muted-foreground">Ingen avvik fra hovedflyten</span>
          )}
        </div>
      )}
    </div>
  );
}
