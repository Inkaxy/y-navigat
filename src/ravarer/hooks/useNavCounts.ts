// Menyens tre merker (databladendringer, avtaler som utløper innen 30 dager, lager under minimum).
// Rask vei: rm_nav_counts (20261124_raske_oppslag_del1). Før SQL-en er kjørt: dagens rm_work_summary (uten godkjenning).
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/hooks/useCompany";
import { callPendingRpc, useReadCapability } from "@/lib/pendingRpc";
import { useWorkSummary } from "@/ravarer/hooks/useWorkData";
import { parseNavCounts, type NavCounts } from "@/ravarer/lib/fastReads";
import { TRANSIENT_RETRY } from "@/ravarer/lib/heavyGate";

export const navCountsKey = (le: string | null) => ["ravarer", "nav-counts", le] as const;

/** `null` = ukjent (lasting/feil) – vises aldri som 0. */
export function useNavCounts(): NavCounts | null {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  const fast = useReadCapability("rm_cap_raske_oppslag_v1");
  const summary = useWorkSummary({ includeApproval: false, enabled: fast === false });
  const quick = useQuery({
    queryKey: navCountsKey(le),
    enabled: !!le && fast === true,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    ...TRANSIENT_RETRY,
    queryFn: async ({ signal }) => {
      const r = await callPendingRpc("rm_nav_counts", { p_legal_entity_id: le }, signal);
      if (r.kind !== "ok") throw new Error("Kunne ikke hente menytellerne.");
      return parseNavCounts(r.data);
    },
  });
  if (fast === true) return quick.data ?? null;
  if (fast === false && summary.data) {
    const s = summary.data;
    return { datasheet_changes: s.data_quality.datasheet_changes, agreements_expiring_30d: s.other.agreements_expiring_30d, stock_below_min: s.other.stock_below_min };
  }
  return null;
}
