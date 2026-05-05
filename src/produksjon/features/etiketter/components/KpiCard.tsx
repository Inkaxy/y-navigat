import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: number | string;
  subtitle?: string;
  tone?: "default" | "warn";
}

export function KpiCard({ label, value, subtitle, tone = "default" }: KpiCardProps) {
  return (
    <Card
      className={cn(
        "p-4 flex flex-col gap-1",
        tone === "warn" && "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900",
      )}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </p>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    </Card>
  );
}
