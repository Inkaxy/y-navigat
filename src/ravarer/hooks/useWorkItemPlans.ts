import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useCompany } from "@/hooks/useCompany";
import { parseSupplierItemLines } from "@/fakturaer/lib/parseRpcJson";
import type { SupplierItemLine } from "@/fakturaer/lib/supplierItems";

export type WorkItemPlanLines = { openLines: number | null; lines: SupplierItemLine[] };

const MAX_KEYS = 60;

/** Parser rm_work_item_plan_lines. Ugyldig/manglende svar per kort = ukjent (fravær i kartet), aldri 0. */
export function parseWorkItemPlans(data: Json | null | undefined): Map<string, WorkItemPlanLines> {
  const out = new Map<string, WorkItemPlanLines>();
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  for (const [k, v] of Object.entries(data)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const ol = (v as Record<string, Json>).open_lines;
    out.set(k, { openLines: typeof ol === "number" && Number.isFinite(ol) ? ol : null, lines: parseSupplierItemLines((v as Record<string, Json>).lines) });
  }
  return out;
}

/** Ett samlet kall for alle synlige varekort (ingen N+1). Nøkkel: `${supplier_id}|${item_key}`. */
export function useWorkItemPlans(keys: readonly { supplier_id: string; item_key: string }[]) {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  const ks = keys.slice(0, MAX_KEYS);
  const sig = ks.map((k) => `${k.supplier_id}|${k.item_key}`).join(",");
  return useQuery({
    queryKey: ["ravarer", "work-item-plans", le, sig],
    enabled: !!le && ks.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rm_work_item_plan_lines", { p_legal_entity_id: le!, p_keys: ks as unknown as Json });
      if (error) throw error;
      return parseWorkItemPlans(data);
    },
  });
}
