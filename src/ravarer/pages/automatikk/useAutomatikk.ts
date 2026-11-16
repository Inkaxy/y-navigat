import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { pendingSelect, useCapability } from "@/lib/pendingRpc";
import { parseAutoSettings, parseKeyLimits, type AutoLogCounts } from "@/ravarer/lib/automatikk";

export const AUTO_KEY = ["ravarer", "automatikk"] as const;

/** Tallene for «Gjort uten deg» (siste `days` døgn). Hvert tall er eksakt antall eller null (ukjent), aldri 0 ved feil. */
export function useAutoLog(days: number) {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  return useQuery({
    queryKey: [...AUTO_KEY, "logg", le, days],
    enabled: !!le,
    staleTime: 60_000,
    queryFn: async (): Promise<AutoLogCounts> => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const count = async (p: PromiseLike<{ count: number | null; error: unknown }>) => { const r = await p; return r.error ? null : r.count; };
      const [newInvoices, linesLinked, linesExcluded, invoicesReconciled, recalculated] = await Promise.all([
        count(supabase.from("invoices").select("id", { count: "exact", head: true }).eq("legal_entity_id", le!).gte("created_at", since)),
        count(supabase.from("invoice_lines").select("id, invoices!inner(legal_entity_id)", { count: "exact", head: true })
          .eq("invoices.legal_entity_id", le!).is("resolved_by", null).eq("requires_review", false).eq("match_confidence", "auto_high").gte("updated_at", since)),
        count(supabase.from("invoice_lines").select("id, invoices!inner(legal_entity_id)", { count: "exact", head: true })
          .eq("invoices.legal_entity_id", le!).is("resolved_by", null).eq("match_confidence", "not_applicable").gte("updated_at", since)),
        count(supabase.from("invoices").select("id", { count: "exact", head: true }).eq("legal_entity_id", le!).eq("reconciled_mode", "auto").gte("reconciled_at", since)),
        count(supabase.from("rm_rematch_queue").select("id", { count: "exact", head: true }).eq("legal_entity_id", le!).not("finished_at", "is", null).gte("finished_at", since)),
      ]);
      return { newInvoices, linesLinked, linesExcluded, invoicesReconciled, recalculated };
    },
  });
}

/** Nye innstillinger fra fase 3 (PENDING). `cap` null = ukjent, false = venter på SQL. */
export function useAutoSettings() {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  const cap = useCapability("rm_cap_automatikk_v1");
  const q = useQuery({
    queryKey: [...AUTO_KEY, "innstillinger", le],
    enabled: !!le && cap === true,
    queryFn: async ({ signal }) => {
      const r = await pendingSelect("invoice_match_settings", `select=deposit_as_follow_item,auto_requeue_stale_enabled,auto_requeue_batch_size,auto_requeue_min_age_days&legal_entity_id=eq.${le}`, signal);
      const p = r.kind === "ok" ? parseAutoSettings(r.data) : null;
      if (!p) throw new Error("Innstillingene kunne ikke leses.");
      return p;
    },
  });
  return { cap, ...q };
}

export function useKeyLimits() {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  const cap = useCapability("rm_cap_automatikk_v1");
  const q = useQuery({
    queryKey: [...AUTO_KEY, "nokkelravarer", le],
    enabled: !!le && cap === true,
    queryFn: async ({ signal }) => {
      const r = await pendingSelect("rm_key_material_limits", `select=id,raw_material_id,max_increase_pct,min_impact_nok,note,raw_materials(name)&legal_entity_id=eq.${le}`, signal);
      const p = r.kind === "ok" ? parseKeyLimits(r.data) : null;
      if (!p) throw new Error("Nøkkelråvarene kunne ikke leses.");
      return p;
    },
  });
  return { cap, ...q };
}

export interface SkipRule { id: string; supplierName: string | null; type: string; value: string; reason: string | null; createdAt: string }
/** Hopp over alltid = selskapets utelatelsesmønstre (samme tabell som matchmotoren leser). */
export function useSkipRules() {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  return useQuery({
    queryKey: [...AUTO_KEY, "hopp-over", le],
    enabled: !!le,
    queryFn: async (): Promise<SkipRule[]> => {
      const { data, error } = await supabase.from("invoice_line_exclusion_patterns")
        .select("id, pattern_type, pattern_value, reason, created_at, suppliers(name)")
        .eq("legal_entity_id", le!).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []).map((r) => ({ id: r.id, supplierName: r.suppliers?.name ?? null, type: r.pattern_type, value: r.pattern_value, reason: r.reason, createdAt: r.created_at }));
    },
  });
}
