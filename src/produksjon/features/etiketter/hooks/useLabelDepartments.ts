import { useProductionDepartments } from "@/features/produksjonsavdelinger/hooks/useProductionDepartments";

/**
 * Convenience wrapper: aktive produksjonsavdelinger for ett selskap.
 */
export function useLabelDepartments(legalEntityId: string | undefined) {
  return useProductionDepartments(legalEntityId, false);
}
