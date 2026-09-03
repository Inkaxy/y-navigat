import { Link } from "react-router-dom";
import type { ComponentType } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type KpiTone = "info" | "warning" | "critical" | "ok" | "default";

const TONE_CLASS: Record<KpiTone, string> = {
  info: "text-[hsl(var(--alert-info))] bg-[hsl(var(--alert-info))]/10",
  warning: "text-[hsl(var(--alert-warning))] bg-[hsl(var(--alert-warning))]/10",
  critical: "text-destructive bg-destructive/10",
  ok: "text-[hsl(var(--alert-success))] bg-[hsl(var(--alert-success))]/10",
  default: "text-primary bg-primary/10",
};

export type OrderDeskKpiProps = {
  label: string;
  value: number | string;
  sub?: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
  tone?: KpiTone;
  loading?: boolean;
  /** Vises i stedet for verdien når datasettet feilet. */
  failed?: boolean;
};

/** Kompakt, klikkbart KPI-felt på ordrekontorets arbeidsbord. */
export function OrderDeskKpi({
  label,
  value,
  sub,
  to,
  icon: Icon,
  tone = "default",
  loading,
  failed,
}: OrderDeskKpiProps) {
  const display = failed ? "–" : value;

  return (
    <Link
      to={to}
      aria-label={`${label}: ${failed ? "ikke tilgjengelig" : display}${sub ? `. ${sub}` : ""}`}
      className="group rounded-lg border border-border bg-card p-3 transition-all hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-caption uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-14" />
          ) : (
            <div className="mt-1 text-2xl font-semibold leading-none text-foreground">
              {display}
            </div>
          )}
          {!loading && (
            <div className="mt-1.5 truncate text-caption text-muted-foreground">
              {failed ? "Kunne ikke hentes" : (sub ?? "\u00a0")}
            </div>
          )}
        </div>
        <span
          aria-hidden="true"
          className={cn("flex h-8 w-8 items-center justify-center rounded-md", TONE_CLASS[tone])}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}
