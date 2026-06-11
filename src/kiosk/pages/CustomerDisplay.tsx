import { useEffect, useRef, useState, useMemo } from "react";
import { useTerminal } from "@/kiosk/context/TerminalContext";
import { useKioskChannel } from "@/kiosk/context/RealtimeContext";
import { useKeypadLayout } from "@/kiosk/hooks/useKeypadLayout";
import { KioskCustomerScreenRender } from "@/kiosk/render/KioskCustomerScreenRender";
import {
  parseCustomerScreen,
  parseTheme,
  themeToVars,
} from "@/kiosk/render/kioskTheme";
import type { CustomerCartPayload } from "@/kiosk/lib/cart";
import {
  CART_UPDATE_EVENT,
  SALE_COMPLETE_EVENT,
  type SaleCompletePayload,
} from "@/kiosk/lib/realtime";

export default function CustomerDisplay() {
  const { terminal } = useTerminal();
  const channel = useKioskChannel();
  const { data: layoutData } = useKeypadLayout(
    terminal!.id,
    terminal?.legal_entity_id ?? null,
  );

  const [cart, setCart] = useState<CustomerCartPayload | null>(null);
  const [thanks, setThanks] = useState<SaleCompletePayload | null>(null);
  const thanksTimer = useRef<number | null>(null);

  // Hold skjermen våken så lenge kunde-skjermen er åpen.
  useEffect(() => {
    let wakelock: WakeLockSentinel | null = null;
    (async () => {
      try {
        // @ts-ignore — eksperimentelt API, ikke i alle typedefs
        wakelock = await navigator.wakeLock?.request?.("screen");
      } catch {
        // ignore
      }
    })();
    return () => {
      try {
        wakelock?.release?.();
      } catch {
        // ignore
      }
    };
  }, []);

  // Lytt på cart_update + sale_complete fra operatør-skjermen.
  useEffect(() => {
    channel.on("broadcast", { event: CART_UPDATE_EVENT }, (msg) => {
      const payload = (msg as { payload?: unknown }).payload;
      if (payload && typeof payload === "object") {
        setCart(payload as CustomerCartPayload);
        if (thanksTimer.current) window.clearTimeout(thanksTimer.current);
        setThanks(null);
      }
    });
    channel.on("broadcast", { event: SALE_COMPLETE_EVENT }, (msg) => {
      const payload = (msg as { payload?: unknown }).payload;
      if (payload && typeof payload === "object") {
        setThanks(payload as SaleCompletePayload);
        setCart(null);
        if (thanksTimer.current) window.clearTimeout(thanksTimer.current);
        thanksTimer.current = window.setTimeout(() => setThanks(null), 6000);
      }
    });
  }, [channel]);

  // Customer screen config: prefer layout.customer_screen jsonb;
  // fall back to terminal.customer_screen_mode for mode.
  const csConfig = useMemo(() => {
    const parsed = parseCustomerScreen(layoutData?.layout.customer_screen ?? null);
    if (terminal?.customer_screen_mode && !layoutData?.layout.customer_screen) {
      return { ...parsed, mode: terminal.customer_screen_mode };
    }
    return parsed;
  }, [layoutData, terminal]);

  const theme = useMemo(() => parseTheme(layoutData?.layout.theme ?? null), [layoutData]);

  const renderCart = useMemo(
    () =>
      (cart?.items ?? []).map((it, i) => ({
        id: String(i),
        label: it.label,
        qty: it.quantity,
        unit: it.unit ?? null,
        line_total: it.line_total,
      })),
    [cart],
  );
  const total = cart?.totals.total_incl_mva ?? 0;

  // Takke-skjerm overlay (bruker theme-vars).
  if (thanks) {
    return (
      <div
        className="fixed inset-0 flex flex-col items-center justify-center"
        style={{
          ...themeToVars(theme),
          background: "var(--kiosk-bg)",
          color: "var(--kiosk-ink)",
          userSelect: "none",
        }}
      >
        <div
          className="rounded-2xl border p-10 text-center"
          style={{
            borderColor: "var(--kiosk-accent)",
            background: "var(--kiosk-accent-soft)",
            minWidth: 480,
          }}
        >
          <div className="text-4xl font-bold" style={{ color: "var(--kiosk-accent)" }}>
            Takk for handelen!
          </div>
          <div className="mt-4 text-xl">
            Sum:{" "}
            <span className="tabular-nums font-semibold">
              {thanks.total_incl_mva.toFixed(2)}
            </span>
          </div>
          {thanks.change_given > 0 && (
            <div className="mt-2 text-lg opacity-80">
              Veksel:{" "}
              <span className="tabular-nums font-semibold">
                {thanks.change_given.toFixed(2)}
              </span>
            </div>
          )}
          {thanks.receipt_number && (
            <div className="mt-3 text-sm opacity-50">{thanks.receipt_number}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0" style={{ userSelect: "none" }}>
      <KioskCustomerScreenRender
        config={csConfig}
        cart={renderCart}
        total={total}
        logoUrl={terminal?.logo_url ?? null}
      />
    </div>
  );
}
