import { useParams } from "react-router-dom";
import { KioskShell } from "@/kiosk/components/KioskShell";
import OperatorLogin from "@/kiosk/pages/OperatorLogin";
import OperatorHome from "@/kiosk/pages/OperatorHome";
import OpenSessionView from "@/kiosk/pages/OpenSessionView";
import Kasse from "@/kiosk/pages/Kasse";
import CustomerDisplay from "@/kiosk/pages/CustomerDisplay";
import OperatorBoot from "@/kiosk/pages/OperatorBoot";
import KioskError from "@/kiosk/pages/KioskError";
import { useOperator } from "@/kiosk/context/OperatorContext";
import { SessionProvider, useSession } from "@/kiosk/context/SessionContext";
import { useParams as _u } from "react-router-dom";

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

export function KioskCustomerRoute() {
  const { terminalId } = useParams();
  if (!terminalId) return <KioskError reason="Mangler terminal-ID i URL." />;
  return (
    <KioskShell terminalId={terminalId} withOperator={false}>
      <CustomerDisplay />
    </KioskShell>
  );
}

// Keep export for potential external imports
export { OperatorHome };
