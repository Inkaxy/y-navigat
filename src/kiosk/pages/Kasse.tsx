import { KioskHeader } from "@/kiosk/components/KioskHeader";
import { BigButton } from "@/kiosk/components/BigButton";
import { KeypadGrid } from "@/kiosk/components/KeypadGrid";
import { useTerminal } from "@/kiosk/context/TerminalContext";
import { useOperator } from "@/kiosk/context/OperatorContext";
import { useSession } from "@/kiosk/context/SessionContext";
import { useKeypadLayout } from "@/kiosk/hooks/useKeypadLayout";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function Kasse() {
  const { terminal } = useTerminal();
  const { operator } = useOperator();
  const { session } = useSession();
  const legalEntityId =
    operator?.legal_entity_id ?? terminal?.legal_entity_id ?? null;

  const { data, isLoading, error } = useKeypadLayout(
    terminal!.id,
    legalEntityId,
  );

  return (
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
                  Det finnes ingen layout bundet til denne terminalen, og ingen
                  default-layout for selskapet. Åpne POS Styring → Tastatur for
                  å sette opp et tastatur.
                </p>
              </div>
            </div>
          )}
          {data && <KeypadGrid data={data} />}
        </div>

        <aside className="hidden w-80 flex-col rounded-xl border border-white/5 bg-white/[0.02] p-4 lg:flex">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#F4ECDC]/60">
            Handlekurv
          </h2>
          <div className="mt-4 flex flex-1 items-center justify-center text-center text-sm text-[#F4ECDC]/40">
            Kurv bygges i K.1b
          </div>
          <div className="mt-4 space-y-2 border-t border-white/5 pt-4">
            <div className="flex justify-between text-sm text-[#F4ECDC]/60">
              <span>Sesjon</span>
              <span className="font-mono text-xs">
                {session?.id.slice(0, 8) ?? "—"}
              </span>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block">
                    <BigButton
                      disabled
                      variant="secondary"
                      className="w-full text-base"
                    >
                      Avslutt skift
                    </BigButton>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Bygges i K.2 (skift-avslutning)</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </aside>
      </div>
    </div>
  );
}
