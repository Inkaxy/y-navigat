// ============================================================================
// PUBLIC CONTRACT — DO NOT BREAK
// ============================================================================
//
// `CakeBuilderEmbedFrame` er den ENESTE godkjente React-komponenten for å
// embedde kakebyggeren via iframe (v1-kontrakten). Den:
//
//   1. Bygger en korrekt /embed/v1/kakebygger/... URL via buildCakeBuilderEmbedUrl.
//   2. Setter opp en createCakeBuilderListener som filtrerer på source + version.
//   3. Eksponerer typede callbacks (onComplete, onCancel, onPriceChange, ...).
//
// Andre apper i samme monorepo (POS, Ordre, Kundeportal) skal bruke ENTEN:
//   - <CakeBuilder>           (in-process React-render, samme bundle)
//   - <CakeBuilderEmbedFrame> (iframe-isolert, men fortsatt 1:1 med Varer)
//
// Det er IKKE lov å skrive en egen <iframe src="/embed/...">-wrapper.
// ESLint blokkerer manuell import av interne deler; denne komponenten er
// den eneste tillatte iframe-veien.
// ============================================================================

import { useEffect, useMemo, useRef } from "react";
import {
  buildCakeBuilderEmbedUrl,
  createCakeBuilderListener,
  type EmbedToParentMessage,
} from "./contract";

export interface CakeBuilderEmbedFrameProps {
  /** Hvilken NBOS-instans iframen skal lastes fra. Default: window.location.origin. */
  origin?: string;
  categoryId: string;
  priceListId: string;
  legalEntityId: string;
  theme?: "light" | "dark";
  vatToggle?: boolean;
  returnUrl?: string;

  /** Layout — wrapper-en setter ingen rammer / borders selv. */
  className?: string;
  style?: React.CSSProperties;
  title?: string;

  // ─── Typede callbacks (samme set som postMessage-protokollen) ────────────
  onReady?: () => void;
  onStepChange?: (stepIndex: number, stepName: string) => void;
  onPriceChange?: (totalExMva: number, totalIncMva: number) => void;
  onConfigUpdated?: () => void;
  onComplete?: (result: import("./contract").CakeResult) => void;
  onCancel?: () => void;
  onError?: (message: string) => void;
}

/**
 * Iframe-versjon av kakebyggeren. Bruk denne i stedet for `<iframe>` direkte
 * — da får du:
 *   - garantert riktig embed-URL (versjonert v1)
 *   - ferdig oppsatt postMessage-listener med source/version-filter
 *   - typede event-handlers
 *
 * Eksempel:
 * ```tsx
 * <CakeBuilderEmbedFrame
 *   categoryId={categoryId}
 *   priceListId={priceListId}
 *   legalEntityId={legalEntityId}
 *   onComplete={(result) => saveOrderLine(result)}
 *   onCancel={() => closeModal()}
 *   className="w-full h-[80vh] rounded-lg border"
 * />
 * ```
 */
export function CakeBuilderEmbedFrame({
  origin,
  categoryId,
  priceListId,
  legalEntityId,
  theme,
  vatToggle,
  returnUrl,
  className,
  style,
  title = "Kakebygger",
  onReady,
  onStepChange,
  onPriceChange,
  onConfigUpdated,
  onComplete,
  onCancel,
  onError,
}: CakeBuilderEmbedFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const src = useMemo(
    () =>
      buildCakeBuilderEmbedUrl({
        origin: origin ?? (typeof window !== "undefined" ? window.location.origin : ""),
        categoryId,
        priceListId,
        legalEntityId,
        theme,
        vatToggle,
        returnUrl,
      }),
    [origin, categoryId, priceListId, legalEntityId, theme, vatToggle, returnUrl],
  );

  useEffect(() => {
    const off = createCakeBuilderListener((msg: EmbedToParentMessage) => {
      // Begrens til meldinger fra _vår_ iframe (hvis flere instanser på siden).
      // event.source-sjekken gjøres ved å slå opp i contentWindow her, men
      // createCakeBuilderListener gir oss kun payload — den filtrerer allerede
      // på source+version, og duplikate cake-builder-iframes på samme side er
      // svært sjeldent. Hvis det blir et reelt problem kan vi utvide kontrakten
      // med en instance_id i v2.
      switch (msg.type) {
        case "cake-builder/ready":
          onReady?.();
          break;
        case "cake-builder/step-changed":
          onStepChange?.(msg.step_index, msg.step_name);
          break;
        case "cake-builder/price-changed":
          onPriceChange?.(msg.total_ex_mva, msg.total_inc_mva);
          break;
        case "cake-builder/config-updated":
          onConfigUpdated?.();
          break;
        case "cake-builder/done":
          onComplete?.(msg.result);
          break;
        case "cake-builder/cancel":
          onCancel?.();
          break;
        case "cake-builder/error":
          onError?.(msg.message);
          break;
      }
    });
    return off;
  }, [onReady, onStepChange, onPriceChange, onConfigUpdated, onComplete, onCancel, onError]);

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={title}
      className={className}
      style={{ border: 0, width: "100%", height: "100%", ...style }}
      allow="clipboard-write"
    />
  );
}
