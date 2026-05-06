import { Badge } from "@/components/ui/badge";
import { INVOICE_STATUSES } from "@/fakturaer/lib/constants";

const TONES: Record<string, string> = {
  success: "bg-success/15 text-success border-success/30",
  danger: "bg-destructive/15 text-destructive border-destructive/30",
  info: "bg-primary/15 text-primary border-primary/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  muted: "bg-muted text-ink-secondary border-line-subtle",
};

export function InvoiceStatusBadge({ status }: { status: string }) {
  const meta = INVOICE_STATUSES.find((s) => s.value === status);
  const label = meta?.label ?? status;
  const tone = meta?.tone ?? "muted";
  return (
    <Badge variant="outline" className={TONES[tone] ?? TONES.muted}>
      {label}
    </Badge>
  );
}
