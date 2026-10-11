import { useMemo } from "react";
import { useListPriceEvidence } from "@/ravarer/hooks/useListPriceEvidence";
import { useRavarerScope } from "@/ravarer/hooks/useRavarerScope";
import { bindEvidence, costEvidenceFor, type CostEvidence, type ListPriceEvidence } from "@/ravarer/lib/listPriceEvidence";

export interface MaterialPriceEvidence {
  /** Ferskt serverbevis bundet til nøyaktig denne versjonen/kostprisen, ellers null. */
  bound: ListPriceEvidence | null;
  cost: CostEvidence;
  loading: boolean;
  isError: boolean;
  checkedAt: string | null;
  refetch: () => void;
}

/**
 * Råvarekortets ene tolkning av pris: samme `rm_list_price_evidence`-eier som listen, med én ID.
 * Topptekst, KPI og pakningskost leser dette — aldri leverandørbufferens siste pris.
 */
export function useMaterialPriceEvidence(rm: { id: string; updated_at: string; current_cost_price: number | null; cost_basis_status?: string | null } | null): MaterialPriceEvidence {
  const { legalEntityId } = useRavarerScope();
  const ids = useMemo(() => (rm ? [rm.id] : []), [rm]);
  const ev = useListPriceEvidence(legalEntityId, ids, !!rm);
  const bound = rm && ev.certified ? bindEvidence({ id: rm.id, updatedAt: rm.updated_at, costPrice: rm.current_cost_price }, ev.certified.byId.get(rm.id)) : null;
  return {
    bound,
    cost: costEvidenceFor(rm?.cost_basis_status, bound, ev.loading),
    loading: ev.loading,
    isError: ev.isError,
    checkedAt: ev.checkedAt,
    refetch: ev.refetch,
  };
}
