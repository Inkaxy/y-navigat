import { Navigate } from "react-router-dom";
import { paths } from "@/ravarer/lib/paths";

/**
 * Pakninger og Pakningsstørrelser var to sider for samme jobb. Ruten beholdes
 * som omdirigering slik at gamle lenker og bokmerker fortsatt virker.
 */
export default function PakningerRedirect() {
  return <Navigate to={paths.pakninger({ filter: "ubekreftet" })} replace />;
}
