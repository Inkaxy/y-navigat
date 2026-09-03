import { Link } from "react-router-dom";
import type { ComponentType } from "react";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DeskSectionState } from "./DeskSectionState";
import type { DeskGroup, DeskRow } from "@/ordre/hooks/useOrderDeskBoard";

export type WorkQueueAction = { to: string; label: string };

export type WorkQueueCardProps = {
  title: string;
  description?: string;
  icon: ComponentType<{ className?: string }>;
  /**
   * Én eller flere navngitte grupper. Hver gruppe har sin egen destinasjon, slik
   * at et kort som blander kilder aldri lover å vise «alle» på ett sted.
   */
  groups: DeskGroup[];
  /** Handlinger i korthodet. Utledes fra gruppene når den utelates. */
  actions?: WorkQueueAction[];
  /** Skjuler gruppeoverskriftene (brukes når kortet bare har én kilde). */
  hideGroupLabels?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  scope: string;
  emptyText?: string;
};

const TONE_BADGE: Record<NonNullable<DeskRow["tone"]>, string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  warning:
    "border-[hsl(var(--alert-warning))]/40 bg-[hsl(var(--alert-warning))]/10 text-[hsl(var(--alert-warning))]",
  info: "border-[hsl(var(--alert-info))]/40 bg-[hsl(var(--alert-info))]/10 text-[hsl(var(--alert-info))]",
  default: "border-border bg-muted text-muted-foreground",
};

function DeskRowList({ rows }: { rows: DeskRow[] }) {
  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-card">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            to={row.to}
            className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium text-foreground">
                {row.primary}
              </span>
              {row.secondary && (
                <span className="mt-0.5 block truncate text-caption text-muted-foreground">
                  {row.secondary}
                </span>
              )}
            </span>
            {row.badge && (
              <Badge
                variant="outline"
                className={cn(
                  "max-w-[45%] shrink-0 truncate text-[10px]",
                  TONE_BADGE[row.tone ?? "default"],
                )}
              >
                {row.badge}
              </Badge>
            )}
            {/* Datoen er sekundær informasjon — den vikes først når kortet er smalt. */}
            {row.meta && (
              <span className="hidden shrink-0 whitespace-nowrap text-caption text-muted-foreground sm:inline">
                {row.meta}
              </span>
            )}
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Prioritert arbeidskø med grupperte, klikkbare rader og egne handlinger per kilde. */
export function WorkQueueCard({
  title,
  description,
  icon: Icon,
  groups,
  actions,
  hideGroupLabels = false,
  isLoading,
  isError,
  error,
  onRetry,
  scope,
  emptyText = "Ingenting krever handling nå.",
}: WorkQueueCardProps) {
  const count = groups.reduce((sum, g) => sum + g.total, 0);
  const visibleRows = groups.reduce((sum, g) => sum + g.rows.length, 0);
  const headerActions = actions ?? groups.map((g) => ({ to: g.to, label: g.toLabel }));
  const showLabels = !hideGroupLabels && groups.length > 1;

  return (
    <Card className="flex h-full min-w-0 flex-col">
      <CardHeader className="space-y-2 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{title}</span>
              {!isLoading && !isError && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  {count}
                </span>
              )}
            </CardTitle>
            {description && <p className="mt-1 text-caption text-muted-foreground">{description}</p>}
          </div>
        </div>
        {headerActions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {headerActions.map((action) => (
              <Button
                key={`${action.to}-${action.label}`}
                asChild
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-xs"
              >
                <Link to={action.to}>
                  {action.label}
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              </Button>
            ))}
          </div>
        )}
      </CardHeader>

      <CardContent className="flex-1 pt-0">
        <DeskSectionState
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={onRetry}
          scope={scope}
          isEmpty={visibleRows === 0}
          emptyText={emptyText}
          skeletonRows={3}
        >
          <div className="space-y-4">
            {groups.map((group) => {
              const overflow = Math.max(0, group.total - group.rows.length);
              if (group.rows.length === 0 && !showLabels) return null;
              return (
                <div key={group.key} className="space-y-1.5">
                  {showLabels && (
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {group.label}
                      </h3>
                      <span className="text-caption tabular-nums text-muted-foreground">
                        {group.total}
                      </span>
                    </div>
                  )}
                  {group.rows.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2.5 text-caption text-muted-foreground">
                      {group.emptyText}
                    </p>
                  ) : (
                    <DeskRowList rows={group.rows} />
                  )}
                  {overflow > 0 && (
                    <p className="text-caption text-muted-foreground">
                      +{overflow} flere —{" "}
                      <Link to={group.to} className="text-primary hover:underline">
                        {group.toLabel.toLowerCase()}
                      </Link>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </DeskSectionState>
      </CardContent>
    </Card>
  );
}
