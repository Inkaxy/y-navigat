import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { fetchEffectivePricesBatch, type PriceCaller } from "@/ordre/hooks/useNBProducts";
import { parseMerknad, type Merknad } from "@/ordre/lib/merknad";

export type CustomerOrderRow = {
  id: string;
  order_number: string;
  delivery_date: string;
  delivery_time: string | null;
  distribution: "delivery" | "pickup";
  final_customer_name: string | null;
  final_customer_email: string | null;
  final_customer_phone: string | null;
  picked_up_at: string | null;
  status: string;
  source: string;
  send_sms_confirm: boolean;
  send_email_confirm: boolean;
  delivery_tour_id: string | null;
  is_paid: boolean;
  line_count: number;
};


export function useCustomerOrders(params: {
  customerId: string | null;
  fromDate: string;
  toDate: string;
  hidePickedUp: boolean;
}) {
  const { customerId, fromDate, toDate, hidePickedUp } = params;
  return useQuery({
    queryKey: ["customer-orders", customerId, fromDate, toDate, hidePickedUp],
    enabled: !!customerId,
    queryFn: async (): Promise<CustomerOrderRow[]> => {
      let q = supabase
        .from("orders")
        .select(
          `id, order_number, delivery_date, delivery_time, distribution,
           final_customer_name, final_customer_email, final_customer_phone,
           picked_up_at, status, source, send_sms_confirm, send_email_confirm,
           delivery_tour_id, is_paid, order_lines(count)`,

        )
        .eq("customer_id", customerId!)
        .eq("is_customer_order", true)
        .gte("delivery_date", fromDate)
        .lte("delivery_date", toDate)
        .order("delivery_date", { ascending: true })
        .order("delivery_time", { ascending: true, nullsFirst: true });

      if (hidePickedUp) q = q.is("picked_up_at", null);

      const { data, error } = await q;
      if (error) throw error;

      return (data ?? []).map((row) => {
        const lc = (row as unknown as { order_lines: { count: number }[] }).order_lines;
        return {
          id: row.id,
          order_number: row.order_number,
          delivery_date: row.delivery_date,
          delivery_time: row.delivery_time as string | null,
          distribution: (row.distribution as "delivery" | "pickup") ?? "delivery",
          final_customer_name: row.final_customer_name as string | null,
          final_customer_email: row.final_customer_email as string | null,
          final_customer_phone: row.final_customer_phone as string | null,
          picked_up_at: row.picked_up_at as string | null,
          status: row.status,
          source: row.source,
          send_sms_confirm: !!row.send_sms_confirm,
          send_email_confirm: !!row.send_email_confirm,
          delivery_tour_id: row.delivery_tour_id as string | null,
          is_paid: !!(row as unknown as { is_paid?: boolean }).is_paid,
          line_count: Array.isArray(lc) && lc[0] ? Number(lc[0].count) : 0,

        } satisfies CustomerOrderRow;
      });
    },
    staleTime: 15_000,
  });
}

export type CustomerOrderLineDraftLoaded = {
  id: string;
  product_id: string;
  product_display_number: number | null;
  product_display_name: string;
  product_unit_of_sale: string;
  quantity: number;
  unit_price: number;
  merknad: Merknad | null;
};



export type CustomerOrderDetail = CustomerOrderRow & {
  lines: CustomerOrderLineDraftLoaded[];
};

export function useCustomerOrderDetail(orderId: string | null) {
  return useQuery({
    queryKey: ["customer-order-detail", orderId],
    enabled: !!orderId,
    queryFn: async (): Promise<CustomerOrderDetail | null> => {
      const { data: order, error } = await supabase
        .from("orders")
        .select(
          `id, order_number, delivery_date, delivery_time, distribution,
           final_customer_name, final_customer_email, final_customer_phone,
           picked_up_at, status, source, send_sms_confirm, send_email_confirm,
           delivery_tour_id, is_paid`,
        )
        .eq("id", orderId!)
        .maybeSingle();
      if (error) throw error;
      if (!order) return null;

      const { data: lines, error: linesErr } = await supabase
        .from("order_lines")
        .select("id, product_id, product_snapshot, quantity, unit_price, sales_unit, line_number, merknad")
        .eq("order_id", orderId!)
        .order("line_number", { ascending: true });
      if (linesErr) throw linesErr;

      return {
        id: order.id,
        order_number: order.order_number,
        delivery_date: order.delivery_date,
        delivery_time: order.delivery_time as string | null,
        distribution: (order.distribution as "delivery" | "pickup") ?? "delivery",
        final_customer_name: order.final_customer_name as string | null,
        final_customer_email: order.final_customer_email as string | null,
        final_customer_phone: order.final_customer_phone as string | null,
        picked_up_at: order.picked_up_at as string | null,
        status: order.status,
        source: order.source,
        send_sms_confirm: !!order.send_sms_confirm,
        send_email_confirm: !!order.send_email_confirm,
        delivery_tour_id: order.delivery_tour_id as string | null,
        is_paid: !!(order as unknown as { is_paid?: boolean }).is_paid,
        line_count: (lines ?? []).length,

        lines: (lines ?? []).map((l) => {
          const snap = (l.product_snapshot ?? {}) as {
            display_number?: number;
            display_name?: string;
            unit_of_sale?: string;
          };
          return {
            id: l.id,
            product_id: l.product_id,
            product_display_number: snap.display_number ?? null,
            product_display_name: snap.display_name ?? "(ukjent produkt)",
            product_unit_of_sale: snap.unit_of_sale ?? l.sales_unit ?? "",
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_price),
            merknad: parseMerknad(l.merknad),
          };
        }),
      };


    },
  });
}

/** Distinct final_customer_name suggestions for autocomplete on this customer. */
export function useFinalCustomerSuggestions(customerId: string | null, search: string) {
  return useQuery({
    queryKey: ["final-customer-suggestions", customerId, search],
    enabled: !!customerId && search.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("final_customer_name, final_customer_email, final_customer_phone, ordered_at")
        .eq("customer_id", customerId!)
        .eq("is_customer_order", true)
        .not("final_customer_name", "is", null)
        .ilike("final_customer_name", `%${search.trim()}%`)
        .order("ordered_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      // De-duplicate by name, keep newest
      const seen = new Set<string>();
      const out: { name: string; email: string | null; phone: string | null }[] = [];
      for (const r of data ?? []) {
        const name = (r.final_customer_name ?? "").trim();
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        out.push({
          name,
          email: r.final_customer_email as string | null,
          phone: r.final_customer_phone as string | null,
        });
        if (out.length >= 8) break;
      }
      return out;
    },
    staleTime: 10_000,
  });
}

export type CustomerOrderLineInput = {
  product_id: string;
  product_display_number: number | null;
  product_display_name: string;
  product_code?: string | null;
  product_unit_of_sale: string;
  product_mva_rate?: number | null;
  quantity: number;
  unit_price: number;
  merknad?: Merknad | null;
};


export type CustomerOrderInput = {
  customerId: string;
  customerSnapshot: Record<string, unknown>;
  invoiceRecipientCustomerId: string | null;
  finalCustomerName: string;
  finalCustomerEmail: string | null;
  finalCustomerPhone: string | null;
  deliveryDate: string;
  deliveryTime: string | null; // "HH:mm:00" or null
  deliveryTourId: string | null;
  distribution: "delivery" | "pickup";
  source: "phone" | "email" | "in_store" | "manual";
  sendSms: boolean;
  sendEmail: boolean;
  isPaid: boolean;
  lines: CustomerOrderLineInput[];

};

export function useCreateCustomerOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CustomerOrderInput) => {
      // 1. Generate order number via existing RPC
      const { data: numData, error: numErr } = await supabase.rpc("next_order_number", {
        p_legal_entity_id: NB_LEGAL_ENTITY_ID,
      });
      if (numErr) throw numErr;
      const numRow = numData?.[0];
      if (!numRow) throw new Error("Kunne ikke generere ordrenummer");

      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id ?? null;

      // 2. Insert order
      // Cast: types.ts may not yet include the A.5.4.1 columns
      // (is_customer_order, distribution, final_customer_*, send_*_confirm)
      const insertPayload = {
        legal_entity_id: NB_LEGAL_ENTITY_ID,
        order_number: numRow.order_number,
        order_year: numRow.order_year,
        order_sequence: numRow.order_sequence,
        source: input.source,
        customer_id: input.customerId,
        customer_snapshot: input.customerSnapshot,
        invoice_recipient_customer_id: input.invoiceRecipientCustomerId,
        status: "confirmed",
        status_changed_by: userId,
        delivery_date: input.deliveryDate,
        delivery_time: input.deliveryTime,
        delivery_tour_id: input.deliveryTourId,
        use_customer_default_address: true,
        is_customer_order: true,
        distribution: input.distribution,
        final_customer_name: input.finalCustomerName,
        final_customer_email: input.finalCustomerEmail,
        final_customer_phone: input.finalCustomerPhone,
        send_sms_confirm: input.sendSms,
        send_email_confirm: input.sendEmail,
        is_paid: input.isPaid,
        created_by: userId,

      };
      const { data: orderRow, error: orderErr } = await supabase
        .from("orders")
        .insert(insertPayload as never)
        .select("id, order_number")
        .single();
      if (orderErr) throw orderErr;

      // 3. Hent priser sentralisert (1 batch-RPC for hele ordren)
      const fallbackLineIndices: number[] = [];
      let priceMap = new Map<string, { price: number; vat_rate: number; source: string; special_price_id: string | null; price_list_id: string | null; is_fallback: boolean }>();
      if (input.lines.length > 0) {
        priceMap = await fetchEffectivePricesBatch({
          productIds: Array.from(new Set(input.lines.map((l) => l.product_id))),
          customerId: input.customerId,
          date: input.deliveryDate,
          caller: "customer_order_create" as PriceCaller,
        });

        const lineRows = input.lines.map((l, idx) => {
          const ep = priceMap.get(l.product_id);
          const unitPrice = ep ? ep.price : 0;
          const vatRate = ep?.vat_rate ?? l.product_mva_rate ?? 15;
          const source = ep?.source ?? "fallback_zero";
          const sourceId = ep?.special_price_id ?? ep?.price_list_id ?? null;
          if (!ep || ep.is_fallback) fallbackLineIndices.push(idx);
          const subtotal = l.quantity * unitPrice;
          const vat = subtotal * (vatRate / 100);
          return {
            order_id: orderRow.id,
            line_number: idx + 1,
            product_id: l.product_id,
            product_snapshot: {
              display_number: l.product_display_number,
              display_name: l.product_display_name,
              code: l.product_code ?? null,
              unit_of_sale: l.product_unit_of_sale,
              mva_rate: vatRate,
            },
            quantity: l.quantity,
            sales_unit: l.product_unit_of_sale,
            unit_price: unitPrice,
            unit_price_source: source,
            unit_price_source_id: sourceId,
            discount_percent: 0,
            line_subtotal_excl_vat: Number(subtotal.toFixed(2)),
            vat_rate: vatRate,
            line_vat: Number(vat.toFixed(2)),
            line_total_incl_vat: Number((subtotal + vat).toFixed(2)),
            merknad: l.merknad ? (l.merknad as unknown as Record<string, unknown>) : null,

          };
        });
        const { error: linesErr } = await supabase.from("order_lines").insert(lineRows as never);

        if (linesErr) throw linesErr;
      }

      return { ...orderRow, has_zero_fallback_lines: fallbackLineIndices };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer-orders"] });
    },
  });
}

export function useUpdateCustomerOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { orderId: string; input: CustomerOrderInput }) => {
      const { orderId, input } = params;
      // 1. Update order header
      const updatePayload = {
        source: input.source,
        delivery_date: input.deliveryDate,
        delivery_time: input.deliveryTime,
        delivery_tour_id: input.deliveryTourId,
        distribution: input.distribution,
        final_customer_name: input.finalCustomerName,
        final_customer_email: input.finalCustomerEmail,
        final_customer_phone: input.finalCustomerPhone,
        send_sms_confirm: input.sendSms,
        send_email_confirm: input.sendEmail,
      };
      const { error: updErr } = await supabase
        .from("orders")
        .update(updatePayload as never)
        .eq("id", orderId);
      if (updErr) throw updErr;

      // 2. Replace lines (simple strategy: delete + insert)
      const { error: delErr } = await supabase.from("order_lines").delete().eq("order_id", orderId);
      if (delErr) throw delErr;

      const fallbackLineIndices: number[] = [];
      if (input.lines.length > 0) {
        const priceMap = await fetchEffectivePricesBatch({
          productIds: Array.from(new Set(input.lines.map((l) => l.product_id))),
          customerId: input.customerId,
          date: input.deliveryDate,
          caller: "customer_order_update" as PriceCaller,
        });

        const lineRows = input.lines.map((l, idx) => {
          const ep = priceMap.get(l.product_id);
          const unitPrice = ep ? ep.price : 0;
          const vatRate = ep?.vat_rate ?? l.product_mva_rate ?? 15;
          const source = ep?.source ?? "fallback_zero";
          const sourceId = ep?.special_price_id ?? ep?.price_list_id ?? null;
          if (!ep || ep.is_fallback) fallbackLineIndices.push(idx);
          const subtotal = l.quantity * unitPrice;
          const vat = subtotal * (vatRate / 100);
          return {
            order_id: orderId,
            line_number: idx + 1,
            product_id: l.product_id,
            product_snapshot: {
              display_number: l.product_display_number,
              display_name: l.product_display_name,
              code: l.product_code ?? null,
              unit_of_sale: l.product_unit_of_sale,
              mva_rate: vatRate,
            },
            quantity: l.quantity,
            sales_unit: l.product_unit_of_sale,
            unit_price: unitPrice,
            unit_price_source: source,
            unit_price_source_id: sourceId,
            discount_percent: 0,
            line_subtotal_excl_vat: Number(subtotal.toFixed(2)),
            vat_rate: vatRate,
            line_vat: Number(vat.toFixed(2)),
            line_total_incl_vat: Number((subtotal + vat).toFixed(2)),
            merknad: l.merknad ? (l.merknad as unknown as Record<string, unknown>) : null,

          };
        });
        const { error: insErr } = await supabase.from("order_lines").insert(lineRows as never);

        if (insErr) throw insErr;
      }

      return { orderId, has_zero_fallback_lines: fallbackLineIndices };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer-orders"] });
      qc.invalidateQueries({ queryKey: ["customer-order-detail"] });
    },
  });
}

export function useDeleteCustomerOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      // Delete lines first (no FK CASCADE configured, do it explicitly)
      const { error: lineErr } = await supabase.from("order_lines").delete().eq("order_id", orderId);
      if (lineErr) throw lineErr;
      const { error } = await supabase.from("orders").delete().eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer-orders"] });
    },
  });
}
