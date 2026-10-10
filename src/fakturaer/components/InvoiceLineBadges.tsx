import { Badge } from "@/components/ui/badge";
import { lineKindLabel, reasonLabelsOf } from "@/fakturaer/lib/supplierItems";

const CONFIDENCE: Record<string, { label: string; variant: "secondary" | "outline" }> = {
  auto_high: { label: "Automatisk · sikker", variant: "secondary" },
  auto_medium: { label: "Automatisk · navn", variant: "outline" },
  auto_low: { label: "Automatisk · usikker", variant: "outline" },
  manual: { label: "Manuell", variant: "secondary" },
  not_applicable: { label: "Ikke vare", variant: "secondary" },
};

export function ConfidenceBadge({ value }: { value: string | null }) {
  const m = value ? CONFIDENCE[value] : undefined;
  if (!m) return null;
  return <Badge variant={m.variant} className="text-[10px]">{m.label}</Badge>;
}

/** Årsaker som chips, linjetype ≠ vare og merknad fra motoren. */
export function InvoiceLineNotes({ reviewReason, lineKind, resolutionNote }: { reviewReason: string | null; lineKind: string | null; resolutionNote: string | null }) {
  const reasons = reasonLabelsOf(reviewReason);
  const kind = lineKind && lineKind !== "vare" ? lineKindLabel(lineKind) : null;
  if (reasons.length === 0 && !kind && !resolutionNote) return null;
  return (
    <div className="space-y-1">
      {(reasons.length > 0 || kind) && (
        <div className="flex flex-wrap gap-1">
          {kind && <span className="rounded border border-line-subtle px-1.5 text-[11px] text-ink-secondary">{kind}</span>}
          {reasons.map((r) => (
            <span key={r} className="rounded border border-warning/30 bg-warning/10 px-1.5 text-[11px] text-warning">{r}</span>
          ))}
        </div>
      )}
      {resolutionNote && <p className="text-[11px] text-ink-secondary">{resolutionNote}</p>}
    </div>
  );
}
