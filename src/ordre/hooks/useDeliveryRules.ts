import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";

export type DeliveryRuleType =
  | "order_deadline"
  | "delivery_weekdays"
  | "available_tours"
  | "available_products"
  | "no_delivery";

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
  customer_group_ids: string[] | null;
  specific_delivery_date: string | null;
  blackout_from: string | null;
  blackout_until: string | null;
  deadline_time: string | null; // "HH:MM:SS"
  deadline_days_before: number | null;
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

export const RULE_TYPE_LABEL: Record<DeliveryRuleType, string> = {
  order_deadline: "Ordrefrist",
  delivery_weekdays: "Hvilke ukedager vi leverer",
  available_tours: "Hvilke turer som skal være tilgjengelig",
  available_products: "Hvilke varer man kan bestille",
  no_delivery: "Ingen leveranse",
};

export const RULE_TYPE_SHORT_LABEL: Record<DeliveryRuleType, string> = {
  order_deadline: "Ordrefrist",
  delivery_weekdays: "Ukedager",
  available_tours: "Turer",
  available_products: "Varer",
  no_delivery: "Stengt",
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
        .order("rule_type", { ascending: true })
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
      let rows = (data ?? []) as unknown as DeliveryRule[];
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

/** Henter alle aktive regler for håndheving — uten filter. */
export function useActiveDeliveryRules() {
  return useQuery({
    queryKey: ["delivery-rules", "active-all"],
    queryFn: async (): Promise<DeliveryRule[]> => {
      const { data, error } = await supabase
        .from("delivery_rules")
        .select("*")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("is_active", true);
      if (error) throw error;
      return (data ?? []) as unknown as DeliveryRule[];
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

export function formatDeadlineDefinition(
  time: string | null,
  daysBefore: number | null,
): string {
  if (!time || daysBefore == null) return "—";
  const t = time.length >= 5 ? time.slice(0, 5) : time;
  if (daysBefore === 0) return `Kl ${t} samme dag som leveranse`;
  if (daysBefore === 1) return `Kl ${t} dagen før leveranse`;
  return `Kl ${t} ${daysBefore} dager før leveranse`;
}

/** Kort, lesbar definisjon per regeltype. */
export function formatRuleDefinition(rule: DeliveryRule): string {
  switch (rule.rule_type) {
    case "order_deadline":
      return formatDeadlineDefinition(rule.deadline_time, rule.deadline_days_before);
    case "delivery_weekdays": {
      const days = (rule.weekdays ?? [])
        .map((d) => WEEKDAY_LABELS_LONG[d - 1])
        .join(", ");
      return days ? `Leverer kun: ${days}` : "Ingen ukedager valgt";
    }
    case "available_tours":
      return `${rule.tour_filter?.length ?? 0} tilgjengelig tur(er)`;
    case "available_products": {
      const v = rule.product_ids?.length ?? 0;
      const g = rule.product_group_ids?.length ?? 0;
      return `${v} vare(r), ${g} salgsgruppe(r)`;
    }
    case "no_delivery":
      return rule.blackout_from && rule.blackout_until
        ? `Stengt ${rule.blackout_from} – ${rule.blackout_until}`
        : "Stengt periode";
    default:
      return "—";
  }
}
