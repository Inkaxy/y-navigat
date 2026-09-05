import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CakeBuilder } from "@/varer/features/cakeBuilder/CakeBuilder";
import {
  listenFromParent,
  postToParent,
  CAKE_BUILDER_SOURCE,
  CAKE_BUILDER_PROTOCOL_VERSION,
} from "@/varer/features/cakeBuilder/protocol";
import { isAllowedOrigin } from "@/varer/features/cakeBuilder/origins";
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
/**
 * `return_url` kan sende nettleseren videre — tillat kun verter som står i
 * origins-allowlisten (samme prinsipp som Login.tsx). Ellers ignoreres den.
 */
function resolveReturnUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return isAllowedOrigin(url.origin) ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function CakeBuilderEmbed() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const [searchParams] = useSearchParams();

  const priceListId = searchParams.get("price_list_id") ?? "";
  const legalEntityId = searchParams.get("legal_entity_id") ?? "";
  const defaultPickupLocationId = searchParams.get("default_pickup_location_id");
  const theme = (searchParams.get("theme") as "light" | "dark") || "light";
  const vatToggle = searchParams.get("vat_toggle") !== "false";
  const returnUrl = resolveReturnUrl(searchParams.get("return_url"));
  const source = searchParams.get("source");
  const needsInjectedSession = source === "kiosk" || source === "portal";
  const [authReady, setAuthReady] = useState(!needsInjectedSession);

  // Optional prefilled customer meta (e.g. when launched from POS-kiosken som
  // allerede har samlet inn kundeopplysningene først). Når disse er satt skal
  // CakeBuilder hoppe over sin egen "customer"-fase.
  const prefillCustomerMeta = (() => {
    const pickup_date = searchParams.get("pickup_date");
    const pickup_location_id =
      searchParams.get("pickup_location_id") ?? defaultPickupLocationId;
    const name = searchParams.get("customer_name");
    const phone = searchParams.get("customer_phone");
    const email = searchParams.get("customer_email");
    if (!pickup_date && !name && !phone) return undefined;
    return {
      pickup_date: pickup_date ?? null,
      pickup_location_id: pickup_location_id ?? null,
      name: name ?? "",
      phone: phone ?? "",
      email: email ?? "",
    };
  })();

  // Når embeden lastes fra POS-kiosken: hent kiosk-sesjonen fra localStorage
  // (storageKey `pos-kiosk-auth`) og injiser den i default supabase-klienten
  // slik at RPC-er som krever `authenticated` virker.
  useEffect(() => {
    if (source !== "kiosk") return;
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem("pos-kiosk-auth");
        if (raw) {
          const parsed = JSON.parse(raw);
          const access_token = parsed?.access_token ?? parsed?.currentSession?.access_token;
          const refresh_token = parsed?.refresh_token ?? parsed?.currentSession?.refresh_token;
          if (access_token && refresh_token) {
            await supabase.auth.setSession({ access_token, refresh_token });
          }
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

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
      "frame-ancestors 'self' https://*.lovable.app https://*.lovable.dev https://*.lovableproject.com https://nottero-bakeri.no https://*.nottero-bakeri.no https://nbhub.no https://*.nbhub.no";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  // Send "ready" once mounted; listen for parent commands
  useEffect(() => {
    postToParent({ type: "cake-builder/ready" });
    const onSetSession = (event: MessageEvent) => {
      // Origin må være allowlistet, og meldingen må komme fra parent-vinduet.
      if (!isAllowedOrigin(event.origin)) return;
      if (event.source !== window.parent) return;
      const data = event.data as
        | {
            source?: string;
            version?: number;
            payload?: { type?: string; access_token?: string; refresh_token?: string };
          }
        | undefined;
      if (!data || typeof data !== "object") return;
      if (data.source !== CAKE_BUILDER_SOURCE) return;
      if (data.version !== CAKE_BUILDER_PROTOCOL_VERSION) return;
      const payload = data.payload;
      if (!payload || payload.type !== "cake-builder/set-session") return;
      if (typeof payload.access_token !== "string" || typeof payload.refresh_token !== "string") return;
      (async () => {
        try {
          await supabase.auth.setSession({
            access_token: payload.access_token!,
            refresh_token: payload.refresh_token!,
          });
        } catch {
          /* ignore */
        } finally {
          setAuthReady(true);
        }
      })();
    };
    window.addEventListener("message", onSetSession);
    const unsub = listenFromParent((msg) => {
      if (msg.type === "cake-builder/set-theme") {
        if (typeof document !== "undefined") {
          if (msg.theme === "dark") document.documentElement.classList.add("dark");
          else document.documentElement.classList.remove("dark");
        }
      }
      // 'init' (initialConfig) and 'reset' implemented in F1.3; set-session
      // is handled separately above with explicit origin validation.
    });
    return () => {
      unsub();
      window.removeEventListener("message", onSetSession);
    };
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

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }


  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      <CakeBuilder
        categoryId={categoryId}
        priceListId={priceListId}
        legalEntityId={legalEntityId}
        defaultPickupLocationId={defaultPickupLocationId}
        initialCustomerMeta={prefillCustomerMeta}
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
