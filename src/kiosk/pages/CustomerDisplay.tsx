import { useEffect } from "react";
import { useTerminal } from "@/kiosk/context/TerminalContext";
import { useKioskChannel } from "@/kiosk/context/RealtimeContext";
import { Logo } from "@/components/brand/Logo";

export default function CustomerDisplay() {
  const { terminal } = useTerminal();
  const channel = useKioskChannel();

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

  // Lytte-rør for K.1: kurv-oppdateringer fra operatør-skjermen.
  useEffect(() => {
    const handler = (payload: unknown) => {
      // eslint-disable-next-line no-console
      console.debug("[kiosk:customer] cart_update", payload);
    };
    channel.on("broadcast", { event: "cart_update" }, handler);
  }, [channel]);

  const logoOnly = terminal?.customer_screen_mode === "logo_only";

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
            className={logoOnly ? "max-h-[60vh] max-w-[80vw]" : "max-h-40 max-w-md"}
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
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center text-[#F4ECDC]/40">
              Handlekurv vises her når salget starter.
            </div>
          </div>
        )}
      </div>

      <footer className="border-t border-white/5 px-8 py-4 text-center text-sm text-[#F4ECDC]/40">
        Ønsker du kvittering? Spør betjeningen.
      </footer>
    </div>
  );
}
