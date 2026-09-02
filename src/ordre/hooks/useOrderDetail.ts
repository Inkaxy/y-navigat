import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { OrderStatus } from "@/ordre/lib/orderStatus";

export type OrderDetail = {
  id: string;
  legal_entity_id: string;
  order_number: string;
  order_year: number;
  order_sequence: number;
  source: string;
  source_reference: string | null;
  customer_id: string;
  customer_snapshot: Record<string, unknown> | null;
  invoice_recipient_customer_id: string | null;
  invoice_recipient_snapshot: Record<string, unknown> | null;
  status: OrderStatus;
  order_kind: string | null;
  approval_reason: string | null;
  delivery_tour_id: string | null;

  status_changed_at: string;
  status_changed_by: string | null;
  ordered_at: string;
  delivery_date: string;
  delivery_time: string | null;
  delivery_address_line1: string | null;
  delivery_address_line2: string | null;
  delivery_postal_code: string | null;
  delivery_city: string | null;
  delivery_country: string | null;
  delivery_instructions: string | null;
  use_customer_default_address: boolean;
  subtotal_excl_vat: number;
  total_discount: number;
  total_vat: number;
  total_incl_vat: number;
  internal_notes: string | null;
  customer_notes: string | null;
  production_notes: string | null;
  store_notes: string | null;
  previous_status_before_hold: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancelled_reason: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  is_return: boolean | null;
  is_customer_order: boolean | null;
};

export type OrderLineDetail = {
  id: string;
  order_id: string;
  line_number: number;
  product_id: string;
  product_snapshot: Record<string, unknown> | null;
  quantity: number;
  sales_unit: string;
  unit_price: number;
  unit_price_source: string | null;
  unit_price_source_id: string | null;
  discount_percent: number;
  line_subtotal_excl_vat: number;
  vat_rate: number;
  line_vat: number;
  line_total_incl_vat: number;
  notes: string | null;
};

export type OrderEvent = {
  id: string;
  order_id: string;
  from_status: string | null;
  to_status: string;
  changed_at: string;
  changed_by: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
};

export function useOrderDetail(id: string | undefined) {
  return useQuery({
    queryKey: ["order", id],
    enabled: !!id,
    queryFn: async (): Promise<OrderDetail | null> => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as OrderDetail | null;
    },
  });
}

export function useOrderLines(orderId: string | undefined) {
  return useQuery({
    queryKey: ["order-lines", orderId],
    enabled: !!orderId,
    queryFn: async (): Promise<OrderLineDetail[]> => {
      const { data, error } = await supabase
        .from("order_lines")
        .select("*")
        .eq("order_id", orderId!)
        .order("line_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as OrderLineDetail[];
    },
  });
}

export function useOrderEvents(orderId: string | undefined) {
  return useQuery({
    queryKey: ["order-events", orderId],
    enabled: !!orderId,
    queryFn: async (): Promise<OrderEvent[]> => {
      const { data, error } = await supabase
        .from("order_status_history")
        .select("*")
        .eq("order_id", orderId!)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as OrderEvent[];
    },
  });
}

/** Hent display_name til en bruker (best-effort, ingen feil hvis ikke funnet) */
export function useUserDisplayNames(userIds: (string | null | undefined)[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean) as string[]));
  return useQuery({
    queryKey: ["user-display-names", ids.sort().join(",")],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase
        .from("users_public")
        .select("id, display_name, first_name, last_name")
        .in("id", ids);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const u of data ?? []) {
        const row = u as { id: string; display_name?: string | null; first_name?: string | null; last_name?: string | null };
        map[row.id] =
          row.display_name ||
          [row.first_name, row.last_name].filter(Boolean).join(" ") ||
          "Ukjent";
      }
      return map;
    },
    staleTime: 5 * 60_000,
  });
}

/** Lytt på endringer i ordren og signaliser via setRemoteUpdated */
export function useOrderRealtime(orderId: string | undefined) {
  const qc = useQueryClient();
  const [remoteUpdated, setRemoteUpdated] = useState<{ at: string; by: string | null } | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [legalEntityId, setLegalEntityId] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (!orderId) {
      setLegalEntityId(null);
      return;
    }
    void supabase
      .from("orders")
      .select("legal_entity_id")
      .eq("id", orderId)
      .maybeSingle()
      .then(({ data }) => setLegalEntityId((data?.legal_entity_id as string | undefined) ?? null));
  }, [orderId]);

  useEffect(() => {
    if (!orderId || !legalEntityId) return;
    const channel = supabase
      .channel(`${legalEntityId}:order:${orderId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `id=eq.${orderId}` },
        (payload) => {
          const newRow = (payload.new ?? {}) as Partial<OrderDetail>;
          const changedBy = newRow.status_changed_by ?? newRow.created_by ?? null;
          if (changedBy && changedBy === currentUserId) {
            // Vår egen endring — invalider stille
            void qc.invalidateQueries({ queryKey: ["order", orderId] });
            return;
          }
          setRemoteUpdated({ at: new Date().toISOString(), by: changedBy ?? null });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_lines", filter: `order_id=eq.${orderId}` },
        () => {
          void qc.invalidateQueries({ queryKey: ["order-lines", orderId] });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "order_status_history", filter: `order_id=eq.${orderId}` },
        () => {
          void qc.invalidateQueries({ queryKey: ["order-events", orderId] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orderId, qc, currentUserId, legalEntityId]);

  function acknowledge() {
    setRemoteUpdated(null);
    void qc.invalidateQueries({ queryKey: ["order", orderId] });
    void qc.invalidateQueries({ queryKey: ["order-lines", orderId] });
    void qc.invalidateQueries({ queryKey: ["order-events", orderId] });
  }

  return { remoteUpdated, acknowledge };
}
