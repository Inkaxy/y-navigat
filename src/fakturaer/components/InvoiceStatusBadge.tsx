import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { INVOICE_STATUSES } from "@/fakturaer/lib/constants";

const TONES: Record<string, string> = {
  success: "bg-success/15 text-success border-success/30",
  danger: "bg-destructive/15 text-destructive border-destructive/30",
  info: "bg-primary/15 text-primary border-primary/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  muted: "bg-muted text-ink-secondary border-line-subtle",
};

export const AUTO_RECONCILED_HINT = "Alle linjer var koblet og innenfor toleranse, og linjesummen stemte med Tripletex";

export function InvoiceStatusBadge({ status, reconciledMode }: { status: string; reconciledMode?: string | null }) {
  if (status === "reconciled" && reconciledMode === "auto") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={TONES.success} tabIndex={0}>Avstemt automatisk</Badge>
        </TooltipTrigger>
        <TooltipContent>{AUTO_RECONCILED_HINT}</TooltipContent>
      </Tooltip>
    );
  }
  const meta = INVOICE_STATUSES.find((s) => s.value === status);
  const label = meta?.label ?? "Ukjent status";
  const tone = meta?.tone ?? "muted";
  return (
    <Badge variant="outline" className={TONES[tone] ?? TONES.muted}>
      {label}
    </Badge>
  );
}
