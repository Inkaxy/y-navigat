import type { LineStatus, StatusTone } from "@/fakturaer/lib/lineStatus";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<StatusTone, string> = {
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "border-line-subtle bg-muted text-ink-secondary",
};

export function LineStatusBadge({ status, className }: { status: Pick<LineStatus, "label" | "tone">; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold",
        TONE_CLASS[status.tone],
        className,
      )}
    >
      {status.label}
    </span>
  );
}

