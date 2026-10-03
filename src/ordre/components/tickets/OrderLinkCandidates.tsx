import { Button } from "@/components/ui/button";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import { formatDateLong } from "@/ordre/lib/format";
import type { AiSuggestion } from "@/ordre/lib/aiSuggestion";
import {
  CONFIDENCE_SHORT,
  CONFIDENCE_TOKEN,
  confidenceLevel,
  DEFAULT_CONFIDENCE_THRESHOLDS,
} from "@/ordre/lib/aiConfidence";
import { useOrdreDeskSettings } from "@/ordre/hooks/useOrdreDeskSettings";

type Candidate = NonNullable<AiSuggestion["candidate_orders"]>[number];

/**
 * AI-foreslåtte ordrer. Alltid merket som forslag — ingenting kobles før et
 * menneske trykker «Koble denne».
 */
export default function OrderLinkCandidates({
  ai,
  excludeIds,
  canWrite,
  onLink,
}: {
  ai: AiSuggestion | null;
  excludeIds: string[];
  canWrite: boolean;
  onLink: (orderId: string, orderNumber: string | null) => void;
}) {
  const { data: desk } = useOrdreDeskSettings();
  const thresholds = desk
    ? { high: desk.confidenceHigh, medium: desk.confidenceMedium }
    : DEFAULT_CONFIDENCE_THRESHOLDS;
  const candidates: Candidate[] = [...(ai?.candidate_orders ?? [])]
    .filter((c) => c.order_id && !excludeIds.includes(c.order_id))
    .sort((a, b) => (b.match_confidence ?? 0) - (a.match_confidence ?? 0))
    .slice(0, 5);
  if (candidates.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="text-caption font-semibold text-muted-foreground">
        Forslag fra AI — må bekreftes ({candidates.length})
      </div>
      <ul className="space-y-1.5">
        {candidates.map((c) => {
          const level = confidenceLevel(c.match_confidence, thresholds) ?? "low";
          return (
            <li
              key={c.order_id}
              className="rounded-[8px] border border-dashed border-border bg-background px-2.5 py-2 text-caption"
            >
              <div className="flex flex-wrap items-center gap-1.5 font-medium text-foreground">
                #{c.order_number ?? c.order_id.slice(0, 8)}
                {c.snapshot?.customer_name ? ` · ${c.snapshot.customer_name}` : ""}
                <StatusPill
                  label={`Forslag · ${CONFIDENCE_SHORT[level]}`}
                  tokenVar={CONFIDENCE_TOKEN[level]}
                  size="sm"
                  hideDot
                />
              </div>
              {c.snapshot?.delivery_date && (
                <div className="text-muted-foreground">
                  Levering {formatDateLong(c.snapshot.delivery_date)}
                </div>
              )}
              {c.why_match && <div className="text-muted-foreground">Belegg: {c.why_match}</div>}
              <Button
                size="sm"
                variant="outline"
                className="mt-1.5 h-7"
                disabled={!canWrite}
                onClick={() => onLink(c.order_id, c.order_number)}
              >
                Koble denne
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
