import { useEffect, useRef, useState } from "react";
import { useTerminal } from "@/kiosk/context/TerminalContext";
import { useKioskChannel } from "@/kiosk/context/RealtimeContext";
import { Logo } from "@/components/brand/Logo";
import type { CustomerCartPayload } from "@/kiosk/lib/cart";
import {
  CART_UPDATE_EVENT,
  SALE_COMPLETE_EVENT,
  type SaleCompletePayload,
} from "@/kiosk/lib/realtime";

export default function CustomerDisplay() {
  const { terminal } = useTerminal();
  const channel = useKioskChannel();
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
        // Ny cart_update overskriver takke-state.
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

  const logoOnly = terminal?.customer_screen_mode === "logo_only";
  const hasItems = !!cart && cart.items.length > 0;
  const showThanks = !!thanks;

  return (
    <div
      className="fixed inset-0 flex flex-col bg-[#0F0E0E] text-[#F4ECDC]"
      style={{ userSelect: "none" }}
    >
      <div
        className={
          logoOnly
            ? "flex flex-1 items-center justify-center p-12"
            : "flex flex-col items-center gap-8 p-12"
        }
      >
        {terminal?.logo_url ? (
          <img
            src={terminal.logo_url}
            alt=""
            draggable={false}
            className={
              logoOnly ? "max-h-[60vh] max-w-[80vw]" : "max-h-40 max-w-md"
            }
          />
        ) : (
          <div className="text-amber-400">
            <Logo
              variant="seal"
              className={logoOnly ? "h-[40vh] w-auto" : "h-36 w-auto"}
            />
          </div>
        )}

        {!logoOnly && (
          <div className="mt-8 w-full max-w-3xl flex-1">
            {hasItems ? (
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6">
                <div className="space-y-1">
                  {cart!.items.map((it, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between border-b border-white/5 py-3 text-lg last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{it.label}</div>
                        <div className="text-sm text-[#F4ECDC]/50">
                          {it.quantity}
                          {it.unit ? ` ${it.unit}` : ""}
                        </div>
                      </div>
                      <div className="ml-4 font-semibold tabular-nums">
                        {it.line_total.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-white/20 pt-4 text-2xl font-bold">
                  <span>Totalt</span>
                  <span className="tabular-nums">
                    {cart!.totals.total_incl_mva.toFixed(2)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center text-[#F4ECDC]/40">
                Handlekurv vises her når salget starter.
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="border-t border-white/5 px-8 py-4 text-center text-sm text-[#F4ECDC]/40">
        Ønsker du kvittering? Spør betjeningen.
      </footer>
    </div>
  );
}
