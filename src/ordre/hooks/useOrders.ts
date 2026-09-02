import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import type { OrderKind, OrderStatus } from "@/ordre/lib/orderStatus";
import { osloTodayISO } from "@/lib/osloDate";

export type OrderListRow = {
  id: string;
  order_number: string;
  status: OrderStatus;
  order_kind: OrderKind;
  approval_reason: string | null;
  source: string;
  customer_id: string;
  customer_snapshot: { display_name?: string; customer_number?: string } | null;
  delivery_date: string;
  delivery_time: string | null;
  delivery_tour_id: string | null;
  total_incl_vat: number;
  status_changed_at: string;
  ordered_at: string;
  created_at: string;
  line_count?: number;
  rule_flags: unknown;
  rule_override_reason: string | null;
};

export type OrderListFilters = {
  search?: string;
  statuses?: OrderStatus[];
  kinds?: OrderKind[];
  source?: string; // 'all' | source-value
  deliveryFrom?: string | null;
  deliveryTo?: string | null;
  customerId?: string | null;
  tourIds?: string[]; // tom = alle
  page?: number;
  pageSize?: number;
};

export function useOrderList(filters: OrderListFilters) {
  const pageSize = filters.pageSize ?? 50;
  const page = filters.page ?? 0;
  return useQuery({
    queryKey: ["orders", filters],
    queryFn: async () => {
      let q = supabase
        .from("orders")
        .select(
          "id, order_number, status, order_kind, approval_reason, source, customer_id, customer_snapshot, delivery_date, delivery_time, delivery_tour_id, total_incl_vat, status_changed_at, ordered_at, created_at, rule_flags, rule_override_reason, order_lines(count)",
          { count: "exact" },
        )
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID);

      if (filters.statuses && filters.statuses.length > 0) {
        q = q.in("status", filters.statuses);
      }
      if (filters.kinds && filters.kinds.length > 0) {
        q = q.in("order_kind", filters.kinds);
      }
      if (filters.source && filters.source !== "all") {
        q = q.eq("source", filters.source);
      }
      if (filters.tourIds && filters.tourIds.length > 0) {
        q = q.in("delivery_tour_id", filters.tourIds);
      }
      if (filters.deliveryFrom) q = q.gte("delivery_date", filters.deliveryFrom);
      if (filters.deliveryTo) q = q.lte("delivery_date", filters.deliveryTo);
      if (filters.customerId) q = q.eq("customer_id", filters.customerId);

      if (filters.search && filters.search.trim().length > 0) {
        const s = filters.search.trim().replace(/[%,]/g, " ");
        q = q.or(
          [
            `order_number.ilike.%${s}%`,
            `internal_notes.ilike.%${s}%`,
            `customer_snapshot->>display_name.ilike.%${s}%`,
            `customer_snapshot->>customer_number.ilike.%${s}%`,
          ].join(","),
        );
      }

      q = q.order("delivery_date", { ascending: true }).range(page * pageSize, page * pageSize + pageSize - 1);

      const { data, error, count } = await q;
      if (error) throw error;

      const rows = (data ?? []).map((r: any) => ({
        ...r,
        line_count: Array.isArray(r.order_lines) && r.order_lines[0] ? r.order_lines[0].count : 0,
      })) as OrderListRow[];

      return { rows, total: count ?? 0 };
    },
    placeholderData: (prev) => prev,
  });
}

export type StatusCount = { status: OrderStatus; count: number };

export function useStatusCounts() {
  return useQuery({
    queryKey: ["order-status-counts"],
    queryFn: async (): Promise<StatusCount[]> => {
      const { data, error } = await supabase
        .from("orders")
        .select("status")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
      }
      return Array.from(counts.entries()).map(([status, count]) => ({
        status: status as OrderStatus,
        count,
      }));
    },
    staleTime: 30_000,
  });
}

export function useDeliveryDayStats(date: string) {
  return useQuery({
    queryKey: ["delivery-day-stats", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, total_incl_vat, status")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("delivery_date", date)
        .not("status", "in", "(cancelled)");
      if (error) throw error;
      const rows = data ?? [];
      const total = rows.reduce((sum, r) => sum + Number(r.total_incl_vat ?? 0), 0);
      const byStatus = new Map<string, number>();
      for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
      const statusBreakdown = Array.from(byStatus.entries()).map(([status, count]) => ({
        status: status as OrderStatus,
        count,
      }));
      return { count: rows.length, total, statusBreakdown };
    },
    staleTime: 30_000,
  });
}

/** Count of orders matching a status across ALL delivery dates */
export function useActionQueueCounts() {
  return useQuery({
    queryKey: ["action-queue-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, status, delivery_date")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .in("status", ["awaiting_confirmation", "confirmed"]);
      if (error) throw error;
      const rows = data ?? [];
      const today = osloTodayISO();
      return {
        awaiting: rows.filter((r) => r.status === "awaiting_confirmation").length,
        confirmedToday: rows.filter(
          (r) => r.status === "confirmed" && r.delivery_date === today,
        ).length,
      };
    },

    staleTime: 30_000,
  });
}
