import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NBE_LEGAL_ENTITY_ID } from "@/rapporter/lib/constants";
import type { DateRange } from "@/rapporter/lib/periods";

export type SalesDimension =
  | "product"
  | "customer"
  | "main_category"
  | "sub_category"
  | "statistic_group"
  | "customer_profile";

export type SalesGranularity = "total" | "day" | "week" | "month";

export type SalesFilters = {
  customerId?: string | null;
  productId?: string | null;
  statisticGroupId?: string | null;
  customerProfileId?: string | null;
};

export type SalesRow = {
  bucket: string | null;
  dim_id: string | null;
  dim_code: string | null;
  dim_label: string;
  amount: number;
  quantity: number;
  line_count: number;
  order_count: number;
};

export const DIMENSION_LABELS: Array<{ value: SalesDimension; label: string }> = [
  { value: "product", label: "Vare" },
  { value: "customer", label: "Kunde" },
  { value: "main_category", label: "Hovedkategori" },
  { value: "sub_category", label: "Underkategori" },
  { value: "statistic_group", label: "Statistikkgruppe" },
  { value: "customer_profile", label: "Kundeprofil" },
];

export async function fetchSalesAggregate(
  range: DateRange,
  dimension: SalesDimension,
  granularity: SalesGranularity,
  filters: SalesFilters = {},
): Promise<SalesRow[]> {
  const { data, error } = await supabase.rpc("sales_aggregate", {
    p_legal_entity_id: NBE_LEGAL_ENTITY_ID,
    p_period_start: range.start,
    p_period_end: range.end,
    p_dimension: dimension,
    p_granularity: granularity,
    p_customer_id: filters.customerId ?? undefined,
    p_product_id: filters.productId ?? undefined,
    p_statistic_group_id: filters.statisticGroupId ?? undefined,
    p_customer_profile_id: filters.customerProfileId ?? undefined,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    bucket: r.bucket ?? null,
    dim_id: r.dim_id ?? null,
    dim_code: r.dim_code ?? null,
    dim_label: r.dim_label ?? "(uten navn)",
    amount: Number(r.amount ?? 0),
    quantity: Number(r.quantity ?? 0),
    line_count: Number(r.line_count ?? 0),
    order_count: Number(r.order_count ?? 0),
  }));
}

export function useSalesAggregate(
  range: DateRange | null,
  dimension: SalesDimension,
  granularity: SalesGranularity,
  filters: SalesFilters = {},
  enabled = true,
) {
  return useQuery({
    queryKey: ["rapporter", "sales-aggregate", range?.start, range?.end, dimension, granularity, filters],
    enabled: enabled && !!range?.start && !!range?.end,
    queryFn: () => fetchSalesAggregate(range!, dimension, granularity, filters),
  });
}

/** Totalsummer for et sett rader. */
export function totals(rows: SalesRow[] | undefined) {
  const r = rows ?? [];
  return {
    amount: r.reduce((s, x) => s + x.amount, 0),
    quantity: r.reduce((s, x) => s + x.quantity, 0),
    lines: r.reduce((s, x) => s + x.line_count, 0),
    orders: r.reduce((s, x) => s + x.order_count, 0),
    count: r.length,
  };
}

/* ---------------- Filter-valg ---------------- */

export function useCustomerProfileOptions() {
  return useQuery({
    queryKey: ["rapporter", "profile-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_profiles")
        .select("id, display_name")
        .eq("legal_entity_id", NBE_LEGAL_ENTITY_ID)
        .order("display_name");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useStatisticGroupOptions() {
  return useQuery({
    queryKey: ["rapporter", "group-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("statistic_groups")
        .select("id, display_name")
        .eq("legal_entity_id", NBE_LEGAL_ENTITY_ID)
        .eq("status", "active")
        .order("sort_order")
        .order("display_name");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 10 * 60 * 1000,
  });
}
