import { AlertTriangle } from "lucide-react";
import { BigButton } from "./BigButton";

interface Props {
  reason: string | null;
  openedAt: string | null;
  busy: boolean;
  onClose: () => void;
}

function formatOpened(openedAt: string | null): string {
  if (!openedAt) return "";
  try {
    return new Date(openedAt).toLocaleTimeString("nb-NO", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

/**
 * Fullskjerms-blokk som vises så lenge kasseskuffen er åpen. Nye salg kan
 * ikke registreres før operatøren bekrefter at skuffen er fysisk lukket.
 */
export function DrawerOpenOverlay({ reason, openedAt, busy, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="mx-4 max-w-lg rounded-3xl border border-amber-400/40 bg-[#1B1410] p-8 text-center text-[#F4ECDC] shadow-2xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20 text-amber-300">
          <AlertTriangle className="h-8 w-8" />
        </div>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight">
          Lukk skuffen for å fortsette
        </h2>
        <p className="mt-3 text-[#F4ECDC]/70">
          Nye salg kan ikke registreres mens kasseskuffen står åpen.
        </p>
        {(reason || openedAt) && (
          <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left text-sm">
            {reason && (
              <div className="flex justify-between">
                <span className="text-[#F4ECDC]/60">Grunn</span>
                <span className="font-medium">{reason}</span>
              </div>
            )}
            {openedAt && (
              <div className="mt-1 flex justify-between">
                <span className="text-[#F4ECDC]/60">Åpnet</span>
                <span className="font-medium tabular-nums">{formatOpened(openedAt)}</span>
              </div>
            )}
          </div>
        )}
        <BigButton onClick={onClose} disabled={busy} className="mt-6 w-full">
          {busy ? "Registrerer…" : "Skuffen er lukket"}
        </BigButton>
      </div>
    </div>
  );
}
