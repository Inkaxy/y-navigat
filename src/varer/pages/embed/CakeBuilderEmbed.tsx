import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CakeBuilder } from "@/varer/features/cakeBuilder/CakeBuilder";
import { listenFromParent, postToParent } from "@/varer/features/cakeBuilder/protocol";
import { supabase } from "@/integrations/supabase/client";
import type { CakeResult, PriceBreakdown } from "@/varer/features/cakeBuilder/types";
import { AlertTriangle, Loader2 } from "lucide-react";

/**
 * Standalone embed surface for the CakeBuilder.
 * Mounted at /embed/kakebygger/:categoryId — outside the AppLayout so it can be
 * iframe-d by other NBOS apps (POS Kiosk, Ordre, Kundeportal).
 *
 * Required query params:
 *   - price_list_id  (UUID)
 *   - legal_entity_id (UUID)
 *
 * Optional:
 *   - theme=light|dark
 *   - vat_toggle=true|false
 *   - return_url
 *
 * Authentication: Backend RPCs are GRANTed only to `authenticated` and
 * cake-tabellene har ingen anon SELECT-policies. Uautentiserte forespørsler
 * mottar tom data fra serveren — ingen klient-side gating her.
 *
 * Frame-ancestors enforcement is intentionally NOT done in F1.2.
 * Real CSP via HTTP response headers comes in F1.3 with edge proxy.
 */
export default function CakeBuilderEmbed() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const [searchParams] = useSearchParams();

  const priceListId = searchParams.get("price_list_id") ?? "";
  const legalEntityId = searchParams.get("legal_entity_id") ?? "";
  const theme = (searchParams.get("theme") as "light" | "dark") || "light";
  const vatToggle = searchParams.get("vat_toggle") !== "false";
  const returnUrl = searchParams.get("return_url");

  // Apply theme to document root
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const prev = root.classList.contains("dark");
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    return () => {
      if (prev) root.classList.add("dark");
      else root.classList.remove("dark");
    };
  }, [theme]);

  // CSP: restrict who can iframe this page (best-effort via meta tag)
  useEffect(() => {
    if (typeof document === "undefined") return;
    const meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content =
      "frame-ancestors 'self' https://*.lovable.app https://*.lovable.dev https://*.lovableproject.com https://nottero-bakeri.no https://*.nottero-bakeri.no";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  // Send "ready" once mounted; listen for parent commands
  useEffect(() => {
    postToParent({ type: "cake-builder/ready" });
    const unsub = listenFromParent((msg) => {
      if (msg.type === "cake-builder/set-theme") {
        if (typeof document !== "undefined") {
          if (msg.theme === "dark") document.documentElement.classList.add("dark");
          else document.documentElement.classList.remove("dark");
        }
      }
      // 'init' (initialConfig) and 'reset' implemented in F1.3
    });
    return unsub;
  }, []);

  const handleComplete = (result: CakeResult) => {
    postToParent({ type: "cake-builder/done", result });
    if (returnUrl) {
      try {
        const url = new URL(returnUrl);
        url.searchParams.set("cake_result", encodeURIComponent(JSON.stringify(result)));
        window.location.href = url.toString();
      } catch {
        // ignore invalid return_url
      }
    }
  };

  const handleCancel = () => {
    postToParent({ type: "cake-builder/cancel" });
    if (returnUrl) window.location.href = returnUrl;
  };

  const handlePriceChange = (price: PriceBreakdown) => {
    postToParent({
      type: "cake-builder/price-changed",
      total_ex_mva: price.total_ex_mva,
      total_inc_mva: price.total_inc_mva,
    });
  };

  const handleStepChange = (stepIndex: number, stepName: string) => {
    postToParent({ type: "cake-builder/step-changed", step_index: stepIndex, step_name: stepName });
  };

  const handleConfigUpdated = () => {
    postToParent({ type: "cake-builder/config-updated" });
  };

  if (!categoryId || !priceListId || !legalEntityId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-8 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive mb-3" />
        <h1 className="text-lg font-semibold mb-2">Manglende parametere</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          Embed-URL må inneholde <code>?price_list_id=…&amp;legal_entity_id=…</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      <CakeBuilder
        categoryId={categoryId}
        priceListId={priceListId}
        legalEntityId={legalEntityId}
        showVatToggle={vatToggle}
        onComplete={handleComplete}
        onCancel={handleCancel}
        onPriceChange={handlePriceChange}
        onStepChange={handleStepChange}
        onConfigUpdated={handleConfigUpdated}
        theme={theme}
      />
    </div>
  );
}
