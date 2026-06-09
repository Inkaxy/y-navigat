import { useMemo } from "react";
import { KioskHeader } from "@/kiosk/components/KioskHeader";
import { KeypadGrid } from "@/kiosk/components/KeypadGrid";
import { CartPanel } from "@/kiosk/components/CartPanel";
import { useTerminal } from "@/kiosk/context/TerminalContext";
import { useOperator } from "@/kiosk/context/OperatorContext";
import { useKioskChannel } from "@/kiosk/context/RealtimeContext";
import { CartProvider } from "@/kiosk/context/CartContext";
import { KeypadNavProvider } from "@/kiosk/context/KeypadNavContext";
import { useKeypadLayout } from "@/kiosk/hooks/useKeypadLayout";

export default function Kasse() {
  const { terminal } = useTerminal();
  const { operator } = useOperator();
  const channel = useKioskChannel();
  const legalEntityId =
    operator?.legal_entity_id ?? terminal?.legal_entity_id ?? null;

  const { data, isLoading, error } = useKeypadLayout(
    terminal!.id,
    legalEntityId,
  );

  const rootPageId = useMemo(() => {
    if (!data) return null;
    return (
      [...data.pages].sort((a, b) => a.sort_order - b.sort_order)[0]?.id ??
      null
    );
  }, [data]);

  return (
    <CartProvider channel={channel}>
      <div className="flex min-h-screen flex-col bg-[#0F0E0E] text-[#F4ECDC]">
        <KioskHeader />

        <div className="flex flex-1 gap-4 p-4">
          <div className="flex flex-1 flex-col">
            {isLoading && (
              <div className="flex flex-1 items-center justify-center text-[#F4ECDC]/60">
                Laster tastatur…
              </div>
            )}
            {error && (
              <div className="flex flex-1 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/5 p-8 text-center text-red-300">
                Feil ved lasting av tastatur: {(error as Error).message}
              </div>
            )}
            {!isLoading && !error && !data && (
              <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 p-12 text-center">
                <div>
                  <p className="text-lg font-medium text-[#F4ECDC]/80">
                    Ingen tastatur konfigurert
                  </p>
                  <p className="mt-2 max-w-md text-sm text-[#F4ECDC]/50">
                    Det finnes ingen layout bundet til denne terminalen, og
                    ingen default-layout for selskapet. Åpne POS Styring →
                    Tastatur for å sette opp et tastatur.
                  </p>
                </div>
              </div>
            )}
            {data && (
              <KeypadNavProvider
                key={data.layout.id}
                rootPageId={rootPageId}
              >
                <KeypadGrid data={data} />
              </KeypadNavProvider>
            )}
          </div>

          <CartPanel />
        </div>
      </div>
    </CartProvider>
  );
}
