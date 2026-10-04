import { useInvoiceAccess } from "@/ravarer/hooks/useInvoiceAccess";
import { useRavarerAccessLevel } from "@/ravarer/hooks/useRavarerAccessLevel";

/**
 * Samme regler som serveren: skrive = write/admin med fakturatilgang
 * (has_ravarer_invoice_access), intern godkjenning = approve/admin
 * (has_ravarer_invoice_approve). Serveren avgjør alltid; dette styrer bare UI.
 */
export function useInvoiceRights() {
  const level = useRavarerAccessLevel();
  const invoice = useInvoiceAccess();
  const has = !!invoice.data;
  const l = level.data ?? "none";
  return {
    loading: level.isLoading || invoice.isLoading,
    canWrite: has && (l === "write" || l === "admin"),
    canApprove: has && (l === "approve" || l === "admin"),
  };
}
