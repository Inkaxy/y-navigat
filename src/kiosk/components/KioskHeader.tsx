import { useState } from "react";
import { LogOut, X } from "lucide-react";
import { useOperator } from "@/kiosk/context/OperatorContext";
import { useTerminal } from "@/kiosk/context/TerminalContext";
import { useSession } from "@/kiosk/context/SessionContext";
import { BigButton } from "./BigButton";
import { CloseSessionModal } from "./CloseSessionModal";

export function KioskHeader() {
  const { terminal } = useTerminal();
  const { operator, logout } = useOperator();
  const { status, session } = useSession();
  const [closeOpen, setCloseOpen] = useState(false);

  const sessionOpen = status === "open" && !!session;

  const handleClosed = () => {
    setCloseOpen(false);
    logout();
  };

  return (
    <header className="flex items-center justify-between border-b border-white/5 bg-[#1B1410] px-6 py-3">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-[#F4ECDC]/50">
          {terminal?.terminal_code ?? "—"}
        </span>
        <span className="text-sm text-[#F4ECDC]/70">{terminal?.display_name}</span>
      </div>
      <div className="flex items-center gap-3">
        {operator && (
          <span className="text-sm text-[#F4ECDC]">{operator.display_name}</span>
        )}
        {sessionOpen && (
          <BigButton
            variant="secondary"
            onClick={() => setCloseOpen(true)}
            className="min-h-[44px] min-w-[44px] px-4 py-2 text-base"
          >
            <X className="mr-2 h-4 w-4" />
            Avslutt skift
          </BigButton>
        )}
        {operator && (
          <BigButton
            variant="ghost"
            onClick={logout}
            className="min-h-[44px] min-w-[44px] px-4 py-2 text-base"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Logg av
          </BigButton>
        )}
      </div>
      {sessionOpen && (
        <CloseSessionModal
          open={closeOpen}
          onOpenChange={setCloseOpen}
          sessionId={session.id}
          openingFloat={Number(session.opening_float ?? 0)}
          onClosed={handleClosed}
        />
      )}
    </header>
  );
}
