import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";

export type DeliveryRuleType = "order_deadline";

export type DeliveryRule = {
  id: string;
  legal_entity_id: string;
  rule_type: DeliveryRuleType;
  name: string;
  description: string | null;
  weekdays: number[] | null;
  tour_filter: string[] | null;
  product_ids: string[] | null;
  product_group_ids: string[] | null;
  customer_ids: string[] | null;
  deadline_time: string; // "HH:MM:SS"
  deadline_days_before: number;
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type DeliveryRuleFilter = {
  search?: string;
  status?: "active" | "inactive" | "all";
  ruleType?: DeliveryRuleType | "all";
};

export function useDeliveryRules(filter: DeliveryRuleFilter = {}) {
  return useQuery({
    queryKey: ["delivery-rules", filter],
    queryFn: async (): Promise<DeliveryRule[]> => {
      let q = supabase
        .from("delivery_rules")
        .select("*")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .order("is_active", { ascending: false })
        .order("name", { ascending: true });

      if (!filter.status || filter.status === "active") {
        q = q.eq("is_active", true);
      } else if (filter.status === "inactive") {
        q = q.eq("is_active", false);
      }

      if (filter.ruleType && filter.ruleType !== "all") {
        q = q.eq("rule_type", filter.ruleType);
      }

      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as DeliveryRule[];
      if (filter.search?.trim()) {
        const s = filter.search.trim().toLowerCase();
        rows = rows.filter(
          (r) =>
            r.name.toLowerCase().includes(s) ||
            (r.description ?? "").toLowerCase().includes(s),
        );
      }
      return rows;
    },
    staleTime: 30_000,
  });
}

export const WEEKDAY_LABELS = ["Ma", "Ti", "On", "To", "Fr", "Lø", "Sø"] as const;
export const WEEKDAY_LABELS_LONG = [
  "mandag",
  "tirsdag",
  "onsdag",
  "torsdag",
  "fredag",
  "lørdag",
  "søndag",
] as const;

/** Format "Kl HH:MM dagen før leveranse" osv. */
export function formatDeadlineDefinition(time: string, daysBefore: number): string {
  const t = time.length >= 5 ? time.slice(0, 5) : time;
  if (daysBefore === 0) return `Kl ${t} samme dag som leveranse`;
  if (daysBefore === 1) return `Kl ${t} dagen før leveranse`;
  return `Kl ${t} ${daysBefore} dager før leveranse`;
}
