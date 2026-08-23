import { useParams } from "react-router-dom";
import { KioskShell } from "@/kiosk/components/KioskShell";
import OperatorLogin from "@/kiosk/pages/OperatorLogin";
import OpenSessionView from "@/kiosk/pages/OpenSessionView";
import Kasse from "@/kiosk/pages/Kasse";
import SelfServiceKasse from "@/kiosk/pages/SelfServiceKasse";
import CustomerDisplay from "@/kiosk/pages/CustomerDisplay";
import OperatorBoot from "@/kiosk/pages/OperatorBoot";
import KioskError from "@/kiosk/pages/KioskError";
import { useOperator, OperatorProvider } from "@/kiosk/context/OperatorContext";
import { SessionProvider, useSession } from "@/kiosk/context/SessionContext";
import { useTerminal } from "@/kiosk/context/TerminalContext";

function SessionSwitch() {
  const { status } = useSession();
  if (status === "loading") return <OperatorBoot label="Henter sesjon…" />;
  if (status === "error")
    return <KioskError reason="Kunne ikke hente sesjon." />;
  if (status === "no_session") return <OpenSessionView />;
  return <Kasse />;
}

function OperatorSwitch({ terminalId }: { terminalId: string }) {
  const { operator } = useOperator();
  if (!operator) return <OperatorLogin />;
  return (
    <SessionProvider terminalId={terminalId}>
      <SessionSwitch />
    </SessionProvider>
  );
}

export function KioskOperatorRoute() {
  const { terminalId } = useParams();
  if (!terminalId) return <KioskError reason="Mangler terminal-ID i URL." />;
  return (
    <KioskShell terminalId={terminalId} withOperator>
      <OperatorSwitch terminalId={terminalId} />
    </KioskShell>
  );
}

function SelfServiceInner({ terminalId }: { terminalId: string }) {
  const { terminal } = useTerminal();
  if (!terminal) return <OperatorBoot label="Henter terminal…" />;
  if (terminal.terminal_mode !== "self_service") {
    return (
      <KioskError reason="Denne terminalen er ikke satt opp som selvbetjent kasse. Endre modus i POS Styring → Terminaler." />
    );
  }
  if (!terminal.self_service_operator_id) {
    return (
      <KioskError reason="Selvbetjent modus mangler tildelt operatør. Sett 'Selvbetjent operatør' i POS Styring → Terminaler." />
    );
  }
  return (
    <OperatorProvider terminalId={terminalId} autoOperatorId={terminal.self_service_operator_id}>
      <SessionProvider terminalId={terminalId}>
        <SelfServiceKasse />
      </SessionProvider>
    </OperatorProvider>
  );
}

export function KioskSelfServiceRoute() {
  const { terminalId } = useParams();
  if (!terminalId) return <KioskError reason="Mangler terminal-ID i URL." />;
  return (
    <KioskShell terminalId={terminalId} withOperator={false}>
      <SelfServiceInner terminalId={terminalId} />
    </KioskShell>
  );
}

export function KioskCustomerRoute() {
  const { terminalId } = useParams();
  if (!terminalId) return <KioskError reason="Mangler terminal-ID i URL." />;
  return (
    <KioskShell terminalId={terminalId} withOperator={false}>
      <CustomerDisplay />
    </KioskShell>
  );
}

