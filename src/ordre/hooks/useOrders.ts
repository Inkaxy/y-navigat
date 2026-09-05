import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { ORDER_STATUSES, type OrderKind, type OrderLifecycle, type OrderStatus } from "@/ordre/lib/orderStatus";
import { osloTodayISO } from "@/lib/osloDate";
import { fetchAllRows } from "@/lib/supabasePaging";


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

/**
 * Statusene en livssyklus kan ha. Livssyklusen utledes i databasen, men den
 * er alltid en delmengde av disse statusene — så filteret kan gjøres i
 * spørringen i stedet for på den lastede siden.
 */
export function lifecycleStatuses(
  lifecycle: OrderLifecycle | "all" | undefined,
): OrderStatus[] | undefined {
  switch (lifecycle) {
    case "awaiting":
      return ["awaiting_confirmation"];
    case "cancelled":
      return ["cancelled"];
    case "delivered":
      return ["delivered"];
    case "invoiced":
      return ["invoiced"];
    case "open":
    case "delivery_note":
      return ["confirmed"];
    default:
      return undefined;
  }
}

/** Livssykluser som ikke kan skilles på status alene (begge er «confirmed»). */
export function needsClientLifecycleRefinement(
  lifecycle: OrderLifecycle | "all" | undefined,
): boolean {
  return lifecycle === "open" || lifecycle === "delivery_note";
}

export type OrderListFilters = {
  search?: string;
  statuses?: OrderStatus[];
  kinds?: OrderKind[];
  source?: string; // 'all' | source-value
  deliveryFrom?: string | null;
  deliveryTo?: string | null;
  customerId?: string | null;
  tourIds?: string[]; // tom = alle
  /** Livssyklusfilter — snevres inn på status i selve spørringen */
  lifecycle?: OrderLifecycle | "all";
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

      const lcStatuses = lifecycleStatuses(filters.lifecycle);
      const statusFilter = lcStatuses
        ? filters.statuses && filters.statuses.length > 0
          ? lcStatuses.filter((s) => filters.statuses!.includes(s))
          : lcStatuses
        : filters.statuses;

      if (statusFilter && statusFilter.length > 0) {
        q = q.in("status", statusFilter);
      } else if (statusFilter && statusFilter.length === 0) {
        return { rows: [] as OrderListRow[], total: 0 };
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

      type QueryRow = Omit<OrderListRow, "line_count"> & {
        order_lines?: { count: number }[] | null;
      };
      const rows: OrderListRow[] = ((data ?? []) as unknown as QueryRow[]).map((r) => ({
        ...r,
        line_count: Array.isArray(r.order_lines) && r.order_lines[0] ? r.order_lines[0].count : 0,
      }));


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
      // Eksakt telling på serveren — vi laster ikke ned ordrene bare for å telle.
      const results = await Promise.all(
        ORDER_STATUSES.map(async ({ value }) => {
          const { count, error } = await supabase
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
            .eq("status", value);
          if (error) throw error;
          return { status: value, count: count ?? 0 };
        }),
      );
      return results;
    },
    staleTime: 30_000,
  });
}

export function useDeliveryDayStats(date: string) {
  return useQuery({
    queryKey: ["delivery-day-stats", date],
    enabled: !!date,
    queryFn: async () => {
      // Kun kolonnene aggregatet trenger, og paginert slik at både antall og
      // sum er riktige også på dager med mer enn 1000 ordre.
      const rows = await fetchAllRows<{ total_incl_vat: number | null; status: string }>(
        (from, to) =>
          supabase
            .from("orders")
            .select("total_incl_vat, status")
            .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
            .eq("delivery_date", date)
            .not("status", "in", "(cancelled)")
            .order("id", { ascending: true })
            .range(from, to),
      );
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
      const today = osloTodayISO();
      // To rene tellinger på serveren i stedet for å laste hele radsettet.
      const [awaitingRes, confirmedRes] = await Promise.all([
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
          .eq("status", "awaiting_confirmation"),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
          .eq("status", "confirmed")
          .eq("delivery_date", today),
      ]);
      if (awaitingRes.error) throw awaitingRes.error;
      if (confirmedRes.error) throw confirmedRes.error;
      return {
        awaiting: awaitingRes.count ?? 0,
        confirmedToday: confirmedRes.count ?? 0,
      };
    },

    staleTime: 30_000,
  });
}

