import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
  valueClassName?: string;
}

/** Felles KPI-kort for Råvarer (leverandørdetalj og råvaredetalj). */
export function Kpi({ label, value, hint, className, valueClassName }: KpiProps) {
  return (
    <Card className={cn("p-4", className)}>
      <p className="text-xs uppercase tracking-wider text-ink-secondary">{label}</p>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums text-ink-primary", valueClassName)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-secondary">{hint}</div>}
    </Card>
  );
}
