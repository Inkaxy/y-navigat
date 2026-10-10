import { Navigate, useLocation } from "react-router-dom";
import { resolveLegacyRavarerUrl } from "@/ravarer/lib/legacyRoutes";
import { paths } from "@/ravarer/lib/paths";

/** Sender gamle Råvarer-lenker (bokmerker, e-post) videre til ny sti. */
export function LegacyRavarerRedirect() {
  const { pathname, search, hash } = useLocation();
  const to = resolveLegacyRavarerUrl(pathname, search) ?? paths.oversikt();
  return <Navigate to={`${to}${hash}`} replace />;
}
