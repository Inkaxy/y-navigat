// ============================================================================
// PUBLIC CONTRACT — DO NOT BREAK
// ============================================================================
//
// Dette er det OFFENTLIGE grensesnittet andre NBOS-apper (POS, Ordre,
// Kundeportal, fremtidige) bruker for å integrere kakebyggeren.
//
// REGLER:
//   1. Alt som eksporteres herfra er en del av v1-kontrakten.
//   2. Ingen breaking changes uten å bumpe CAKE_BUILDER_PROTOCOL_VERSION
//      OG opprette en ny embed-rute (/embed/v2/kakebygger/...).
//   3. Endringer her må oppdatere snapshot-testen i __tests__/contract.test.ts.
//   4. Konsumenter skal IKKE importere fra ./protocol, ./types, ./CakeBuilder
//      eller andre interne filer direkte. ESLint blokkerer dette.
//
// Embed-URL: https://vare-flyt.lovable.app/embed/v1/kakebygger/<categoryId>
//   ?price_list_id=<UUID>&legal_entity_id=<UUID>&theme=light&vat_toggle=true
//
// ============================================================================

// ─── Komponenter (for direkte React-import) ────────────────────────────────
// To godkjente måter å rendere kakebyggeren på i React:
//   1. <CakeBuilder>           — in-process, samme bundle (raskest)
//   2. <CakeBuilderEmbedFrame> — iframe-isolert, men 1:1 med Varer-preview
// Ingen tredje vei. Aldri skriv en egen <iframe src="/embed/..."> manuelt.
export { CakeBuilder } from "./CakeBuilder";
export type { CakeBuilderProps } from "./CakeBuilder";
export { CakeBuilderEmbedFrame } from "./CakeBuilderEmbedFrame";
export type { CakeBuilderEmbedFrameProps } from "./CakeBuilderEmbedFrame";

// ─── Datatyper (returneres til konsumenten) ────────────────────────────────
export type {
  CakeResult,
  CakeConfig,
  PriceBreakdown,
  PriceLine,
  SelectionType,
  CakeOrderLine,
  CakeAccessoryLine,
  CakeLabelPayload,
} from "./types";

// ─── postMessage-protokoll ─────────────────────────────────────────────────
export {
  CAKE_BUILDER_SOURCE,
  CAKE_BUILDER_PROTOCOL_VERSION,
} from "./protocol";
export type {
  EmbedToParentMessage,
  ParentToEmbedMessage,
  WrappedMessage,
} from "./protocol";

// ─── Regel-evaluering (felles logikk for alle apper) ──────────────────────
// Bruk disse i stedet for å skrive egen rule_type-switch. Da unngår vi at
// "require_all" vs "require_all_selected"-mismatch oppstår på nytt.
export { evaluateRule, normalizeRuleType } from "./ruleEvaluation";
export type { CanonicalRuleType, EvaluateRuleInput } from "./ruleEvaluation";

// ─── Helper for parent-apper som lytter på iframe-meldinger ───────────────
import {
  CAKE_BUILDER_SOURCE,
  CAKE_BUILDER_PROTOCOL_VERSION,
  type EmbedToParentMessage,
  type WrappedMessage,
} from "./protocol";

/**
 * Lager en `message`-event-listener som filtrerer på NBOS Cake Builder-protokollen
 * og kaller `handler` kun for gyldige, versjon-matchende meldinger.
 *
 * Kan kopieres rett inn i andre apper, eller importeres hvis appen ligger i
 * samme monorepo:
 *
 * ```ts
 * import { createCakeBuilderListener } from "@/varer/features/cakeBuilder/contract";
 *
 * useEffect(() => {
 *   const off = createCakeBuilderListener((msg) => {
 *     if (msg.type === "cake-builder/done") saveOrderLine(msg.result);
 *     if (msg.type === "cake-builder/cancel") closeModal();
 *   });
 *   return off;
 * }, []);
 * ```
 *
 * Returnerer en cleanup-funksjon som fjerner listeneren.
 */
export function createCakeBuilderListener(
  handler: (msg: EmbedToParentMessage) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: MessageEvent) => {
    const data = event.data as WrappedMessage<EmbedToParentMessage> | undefined;
    if (!data || typeof data !== "object") return;
    if (data.source !== CAKE_BUILDER_SOURCE) return;
    if (data.version !== CAKE_BUILDER_PROTOCOL_VERSION) return;
    if (!data.payload || typeof data.payload !== "object") return;
    handler(data.payload);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

/**
 * Bygger en korrekt embed-URL for v1-kontrakten. Bruk denne i stedet for å
 * bygge URL-en for hånd, slik at endringer i URL-mønsteret kun trenger å
 * gjøres ett sted.
 */
export function buildCakeBuilderEmbedUrl(args: {
  /** Base-URL til Varer-appen, f.eks. "https://vare-flyt.lovable.app" */
  origin: string;
  categoryId: string;
  priceListId: string;
  legalEntityId: string;
  theme?: "light" | "dark";
  vatToggle?: boolean;
  returnUrl?: string;
}): string {
  const params = new URLSearchParams({
    price_list_id: args.priceListId,
    legal_entity_id: args.legalEntityId,
  });
  if (args.theme) params.set("theme", args.theme);
  if (args.vatToggle !== undefined) params.set("vat_toggle", String(args.vatToggle));
  if (args.returnUrl) params.set("return_url", args.returnUrl);
  return `${args.origin.replace(/\/$/, "")}/embed/v1/kakebygger/${args.categoryId}?${params.toString()}`;
}
