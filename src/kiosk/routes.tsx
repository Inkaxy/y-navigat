import { useParams } from "react-router-dom";
import { KioskShell } from "@/kiosk/components/KioskShell";
import OperatorLogin from "@/kiosk/pages/OperatorLogin";
import OperatorHome from "@/kiosk/pages/OperatorHome";
import CustomerDisplay from "@/kiosk/pages/CustomerDisplay";
import KioskError from "@/kiosk/pages/KioskError";
import { useOperator } from "@/kiosk/context/OperatorContext";

function OperatorSwitch() {
  const { operator } = useOperator();
  return operator ? <OperatorHome /> : <OperatorLogin />;
}

export function KioskOperatorRoute() {
  const { terminalId } = useParams();
  if (!terminalId) return <KioskError reason="Mangler terminal-ID i URL." />;
  return (
    <KioskShell terminalId={terminalId} withOperator>
      <OperatorSwitch />
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
