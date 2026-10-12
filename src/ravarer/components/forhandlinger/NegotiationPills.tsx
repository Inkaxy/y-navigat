import { StatusPill } from "@/ordre/components/ui/status-pill";
import { labelFor, LIVE_ITEM_STATUS_LABELS, NEGOTIATION_STATUS_LABELS, RECIPIENT_STATUS_LABELS } from "@/ravarer/lib/labels";

/** Felles statusmerker for forhandlinger — én etikettkilde (`labels.ts`). */
export function NegotiationStatusPill({ status }: { status: string | null | undefined }) {
  const m = labelFor(NEGOTIATION_STATUS_LABELS, status, "Ukjent status");
  return <StatusPill label={m.label} tokenVar={m.tokenVar} title={m.hint} />;
}
export function RecipientStatusPill({ status }: { status: string | null | undefined }) {
  const m = labelFor(RECIPIENT_STATUS_LABELS, status, "Ukjent status");
  return <StatusPill label={m.label} tokenVar={m.tokenVar} />;
}
export function LiveItemStatusPill({ status }: { status: string | null | undefined }) {
  const m = labelFor(LIVE_ITEM_STATUS_LABELS, status, "Ukjent status");
  return <StatusPill label={m.label} tokenVar={m.tokenVar} />;
}
