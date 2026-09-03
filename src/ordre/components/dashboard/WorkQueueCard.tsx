import { Link } from "react-router-dom";
import type { ComponentType } from "react";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DeskSectionState } from "./DeskSectionState";
import type { DeskRow } from "@/ordre/hooks/useOrderDeskBoard";

export type WorkQueueCardProps = {
  title: string;
  description?: string;
  icon: ComponentType<{ className?: string }>;
  rows: DeskRow[];
  /** Totalt antall i køen (kan være større enn `rows.length`). */
  total?: number;
  viewAllTo: string;
  viewAllLabel?: string;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  scope: string;
  emptyText?: string;
  maxRows?: number;
};

const TONE_BADGE: Record<NonNullable<DeskRow["tone"]>, string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  warning:
    "border-[hsl(var(--alert-warning))]/40 bg-[hsl(var(--alert-warning))]/10 text-[hsl(var(--alert-warning))]",
  info: "border-[hsl(var(--alert-info))]/40 bg-[hsl(var(--alert-info))]/10 text-[hsl(var(--alert-info))]",
  default: "border-border bg-muted text-muted-foreground",
};

/** Prioritert arbeidskø med klikkbare rader, tom-/feiltilstand og «Vis alle». */
export function WorkQueueCard({
  title,
  description,
  icon: Icon,
  rows,
  total,
  viewAllTo,
  viewAllLabel = "Vis alle",
  isLoading,
  isError,
  error,
  onRetry,
  scope,
  emptyText = "Ingenting krever handling nå.",
  maxRows = 6,
}: WorkQueueCardProps) {
  const visible = rows.slice(0, maxRows);
  const count = total ?? rows.length;
  const overflow = Math.max(0, count - visible.length);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
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
          {description && (
            <p className="mt-1 text-caption text-muted-foreground">{description}</p>
          )}
        </div>
        <Button asChild size="sm" variant="ghost" className="h-7 shrink-0 gap-1 px-2 text-xs">
          <Link to={viewAllTo}>
            {viewAllLabel}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </Button>
      </CardHeader>

      <CardContent className="flex-1 pt-0">
        <DeskSectionState
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={onRetry}
          scope={scope}
          isEmpty={visible.length === 0}
          emptyText={emptyText}
          skeletonRows={3}
        >
          <ul className="divide-y divide-border rounded-md border border-border bg-card">
            {visible.map((row) => (
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
                      className={cn("shrink-0 text-[10px]", TONE_BADGE[row.tone ?? "default"])}
                    >
                      {row.badge}
                    </Badge>
                  )}
                  {row.meta && (
                    <span className="shrink-0 whitespace-nowrap text-caption text-muted-foreground">
                      {row.meta}
                    </span>
                  )}
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
          {overflow > 0 && (
            <p className="mt-2 text-caption text-muted-foreground">
              +{overflow} flere —{" "}
              <Link to={viewAllTo} className="text-primary hover:underline">
                {viewAllLabel.toLowerCase()}
              </Link>
            </p>
          )}
        </DeskSectionState>
      </CardContent>
    </Card>
  );
}
