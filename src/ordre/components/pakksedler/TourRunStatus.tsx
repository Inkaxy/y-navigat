import { Check, AlertTriangle, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTourRunStatus, type TourStatusRow } from "@/hooks/useTourRunStatus";

type Props = {
  date: string; // ISO yyyy-MM-dd
  className?: string;
};

function chipClasses(row: TourStatusRow): string {
  switch (row.status) {
    case "completed":
      return "border-emerald-300 bg-emerald-50 text-emerald-900";
    case "pending":
      return "border-orange-300 bg-orange-50 text-orange-900";
    case "no_orders":
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function StatusIcon({ status }: { status: TourStatusRow["status"] }) {
  if (status === "completed") return <Check className="h-3.5 w-3.5" aria-hidden />;
  if (status === "pending") return <AlertTriangle className="h-3.5 w-3.5" aria-hidden />;
  return <Minus className="h-3.5 w-3.5" aria-hidden />;
}

function statusLabel(row: TourStatusRow): string {
  if (row.status === "completed") return "Kjørt";
  if (row.status === "pending") return `Gjenstår — ${row.order_count} ordre`;
  return "Ingen ordre";
}

export function TourRunStatus({ date, className }: Props) {
  const { rows, isLoading } = useTourRunStatus(date);

  if (isLoading && rows.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border border-border bg-background p-3",
        className,
      )}
      aria-label="Tur-status for valgt leveransedato"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Tur-status:
      </span>
      {rows.map((row) => (
        <span
          key={row.id}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm",
            chipClasses(row),
          )}
          title={statusLabel(row)}
        >
          <StatusIcon status={row.status} />
          <span className="font-medium">{row.display_name}</span>
          <span className="text-xs opacity-80">{statusLabel(row)}</span>
        </span>
      ))}
    </div>
  );
}
