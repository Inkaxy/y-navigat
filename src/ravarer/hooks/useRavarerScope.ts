import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";

/**
 * Selskap og bruker for Råvarer-hooks uten å kreve `RavarerProvider`.
 * Delte flater (f.eks. «Ny råvare» i oppskriftseditoren under /varer) må
 * fungere utenfor Råvarer-appen.
 */
export function useRavarerScope() {
  const { user } = useAuth();
  const { data: company } = useCompany();
  return { legalEntityId: company?.id ?? "", user };
}
