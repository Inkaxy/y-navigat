import { AlertTriangle, CheckCircle2, CircleHelp, MinusCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { marginStatusMeta, type MarginTone } from "@/varer/lib/marginStatus";

const TONE_CLASS: Record<MarginTone, string> = {
  ok: "border-success/40 bg-success/10 text-success",
  warn: "border-warning/40 bg-warning/10 text-warning",
  bad: "border-destructive/40 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted text-muted-foreground",
};
const TONE_ICON = { ok: CheckCircle2, warn: AlertTriangle, bad: XCircle, neutral: MinusCircle } as const;

export function MarginStatusBadge({ status }: { status: string | null | undefined }) {
  const meta = marginStatusMeta(status);
  const Icon = status ? TONE_ICON[meta.tone] : CircleHelp;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-medium", TONE_CLASS[meta.tone])}>
      <Icon className="h-3 w-3" aria-hidden="true" /> {meta.label}
    </span>
  );
}
