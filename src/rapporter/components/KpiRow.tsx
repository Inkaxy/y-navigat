import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type Kpi = {
  label: string;
  value: string;
  hint?: string;
};

export function KpiRow({ items, className }: { items: Kpi[]; className?: string }) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {items.map((k) => (
        <Card key={k.label}>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{k.value}</p>
            {k.hint ? <p className="mt-1 text-xs text-muted-foreground">{k.hint}</p> : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
