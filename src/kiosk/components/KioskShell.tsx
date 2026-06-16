import { useEffect, type ReactNode } from "react";
import { KioskAuthProvider, useKioskAuth } from "@/kiosk/context/KioskAuthContext";
import { TerminalProvider, useTerminal } from "@/kiosk/context/TerminalContext";
import { RealtimeProvider } from "@/kiosk/context/RealtimeContext";
import { OperatorProvider } from "@/kiosk/context/OperatorContext";
import { ErrorFullScreen } from "./ErrorFullScreen";
import OperatorBoot from "@/kiosk/pages/OperatorBoot";

interface Props {
  terminalId: string;
  withOperator: boolean;
  autoOperatorId?: string | null;
  children: ReactNode;
}

/**
 * Wrapper for alle Kiosk-ruter. Bypass NBhub-shell og NBhub-auth.
 * - Auto-login som delt Kiosk-bruker (egen storageKey 'pos-kiosk-auth')
 * - Henter terminal og setter TerminalProvider
 * - Setter RealtimeProvider (broadcast-channel)
 * - Setter OperatorProvider kun for operatør-rute
 * - Disable text-selection, drag og context-menu globalt
 */
export function KioskShell({ terminalId, withOperator, autoOperatorId, children }: Props) {
  useEffect(() => {
    const prevHtmlBg = document.documentElement.style.backgroundColor;
    const prevBodyBg = document.body.style.backgroundColor;
    document.documentElement.style.backgroundColor = "#0F0E0E";
    document.body.style.backgroundColor = "#0F0E0E";
    document.documentElement.classList.add("kiosk-active");

    const onCtxMenu = (e: MouseEvent) => e.preventDefault();
    const onDragStart = (e: DragEvent) => e.preventDefault();
    const onSelectStart = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onCtxMenu);
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("selectstart", onSelectStart);

    return () => {
      document.documentElement.style.backgroundColor = prevHtmlBg;
      document.body.style.backgroundColor = prevBodyBg;
      document.documentElement.classList.remove("kiosk-active");
      document.removeEventListener("contextmenu", onCtxMenu);
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("selectstart", onSelectStart);
    };
  }, []);

  return (
    <KioskAuthProvider>
      <KioskAuthGate>
        <TerminalProvider terminalId={terminalId}>
          <TerminalGate>
            <RealtimeProvider terminalId={terminalId}>
              {withOperator ? (
                <OperatorProvider terminalId={terminalId} autoOperatorId={autoOperatorId ?? null}>
                  {children}
                </OperatorProvider>
              ) : (
                children
              )}
            </RealtimeProvider>
          </TerminalGate>
        </TerminalProvider>
      </KioskAuthGate>
    </KioskAuthProvider>
  );
}

function KioskAuthGate({ children }: { children: ReactNode }) {
  const auth = useKioskAuth();
  if (auth.status === "missing_env") {
    return (
      <ErrorFullScreen
        title="Kiosk-konfigurasjon mangler"
        message="VITE_KIOSK_EMAIL og/eller VITE_KIOSK_PASSWORD er ikke satt for dette miljøet."
        details="Legg inn begge variablene i Lovable Workspace Build Secrets (eller .env) og last inn på nytt."
      />
    );
  }
  if (auth.status === "auth_failed") {
    return (
      <ErrorFullScreen
        title="Kunne ikke logge på Kiosk"
        message="Den delte Kiosk-brukeren ble avvist av Supabase."
        details={auth.errorMessage}
      />
    );
  }
  if (auth.status !== "ready") return <OperatorBoot label="Klargjør Kiosk…" />;
  return <>{children}</>;
}

function TerminalGate({ children }: { children: ReactNode }) {
  const { status, errorMessage } = useTerminal();
  if (status === "loading") return <OperatorBoot label="Henter terminal…" />;
  if (status === "not_found") {
    return (
      <ErrorFullScreen
        title="Terminal finnes ikke"
        message="ID-en i URL-en peker ikke til en gyldig kassepunkt-terminal."
      />
    );
  }
  if (status === "error") {
    return (
      <ErrorFullScreen title="Feil ved oppslag av terminal" details={errorMessage} />
    );
  }
  return <>{children}</>;
}
