import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchListEvidence,
  LIST_EVIDENCE_KEY,
  LIST_EVIDENCE_MAX_AGE_MS,
  LIST_EVIDENCE_REFETCH_MS,
  type EvidenceRpc,
  type ListPriceEvidence,
} from "@/ravarer/lib/listPriceEvidence";

const rpc = (legalEntityId: string): EvidenceRpc => async (ids, signal) => {
  const { data, error } = await supabase
    .rpc("rm_list_price_evidence", { p_legal_entity_id: legalEntityId, p_raw_material_ids: ids })
    .abortSignal(signal);
  if (error) throw error;
  return data;
};

export interface ListEvidenceState {
  /** Bare satt når beviset er komplett, ferskt, uten pågående henting og for dette selskapet. */
  certified: { checkedAt: string; byId: Map<string, ListPriceEvidence> } | null;
  loading: boolean;
  isError: boolean;
  checkedAt: string | null;
  refetch: () => void;
}

/**
 * Én eier for listens prisgrunnlag: hele selskapets råvarer i batcher (maks 100, høyst to samtidig),
 * delt cache per selskap + sorterte ID-er. Ingen per-rad-kall og ingen 30-sekunders polling.
 * Lasting, feil, oppfrisking og utløpt frist sertifiserer ingenting.
 */
export function useListPriceEvidence(legalEntityId: string | null | undefined, ids: readonly string[], enabled: boolean): ListEvidenceState {
  const sorted = useMemo(() => [...new Set(ids)].sort(), [ids]);
  const idsKey = sorted.join(",");
  const q = useQuery({
    queryKey: [LIST_EVIDENCE_KEY, legalEntityId, idsKey],
    enabled: enabled && !!legalEntityId && sorted.length > 0,
    queryFn: async ({ signal }) => {
      const entity = legalEntityId as string;
      const r = await fetchListEvidence(entity, sorted, rpc(entity), signal);
      return { ...r, entity, receivedAt: Date.now() };
    },
    staleTime: 5 * 60_000,
    refetchInterval: LIST_EVIDENCE_REFETCH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  // Ny gjengivelse når fristen passeres, så utløpt bevis aldri står som godkjent.
  const [now, setNow] = useState(() => Date.now());
  const expiry = q.data ? q.data.receivedAt + LIST_EVIDENCE_MAX_AGE_MS + 1 : null;
  useEffect(() => {
    if (expiry == null) return;
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, expiry - Date.now()));
    return () => clearTimeout(t);
  }, [expiry]);
  const clock = Math.max(now, Date.now());
  const fresh = enabled && sorted.length > 0 && !!legalEntityId && q.isSuccess && !q.isFetching && !q.isError && !!q.data
    && q.data.entity === legalEntityId && clock - q.data.receivedAt <= LIST_EVIDENCE_MAX_AGE_MS;
  return {
    certified: fresh && q.data ? { checkedAt: q.data.checkedAt, byId: q.data.byId } : null,
    loading: enabled && q.isFetching,
    isError: q.isError,
    checkedAt: fresh && q.data ? q.data.checkedAt : null,
    refetch: () => { void q.refetch(); },
  };
}
