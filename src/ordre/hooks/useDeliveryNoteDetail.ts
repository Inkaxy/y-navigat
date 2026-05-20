import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DeliveryNoteLine = {
  id: string;
  line_number: number;
  product_id: string;
  product_snapshot: Record<string, unknown> | null;
  quantity: number;
  sales_unit: string;
  unit_price: number;
  discount_percent: number;
  vat_rate: number;
  line_subtotal_excl_vat: number;
  line_vat: number;
  line_total_incl_vat: number;
  notes: string | null;
  order_line_id: string | null;
  order_id: string | null;
};

export type DeliveryNoteLegalEntity = {
  legal_name: string;
  org_number: string;
  invoice_address_line1: string | null;
  invoice_postal_code: string | null;
  invoice_city: string | null;
};

export type DeliveryNoteDetail = {
  id: string;
  display_number: string;
  delivery_date: string;
  delivery_tour_id: string | null;
  route_label: string | null;
  status: string;
  customer_id: string;
  customer_snapshot: Record<string, unknown> | null;
  delivery_address_snapshot: Record<string, unknown> | null;
  subtotal_excl_vat: number;
  total_vat: number;
  total_incl_vat: number;
  notes: string | null;
  legal_entity: DeliveryNoteLegalEntity | null;
  lines: DeliveryNoteLine[];
};

export function useDeliveryNoteDetail(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ["delivery-note-detail", id],
    queryFn: async (): Promise<DeliveryNoteDetail | null> => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("delivery_notes")
        .select(
          "id, display_number, delivery_date, delivery_tour_id, route_label, status, legal_entity_id, customer_id, customer_snapshot, delivery_address_snapshot, subtotal_excl_vat, total_vat, total_incl_vat, notes, delivery_note_lines(id, line_number, product_id, product_snapshot, quantity, sales_unit, unit_price, discount_percent, vat_rate, line_subtotal_excl_vat, line_vat, line_total_incl_vat, notes, order_line_id, order_id)"
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      const legalEntityId = (data as any).legal_entity_id as string | null;
      let legal: DeliveryNoteLegalEntity | null = null;
      if (legalEntityId) {
        const { data: le } = await supabase
          .from("legal_entities")
          .select("legal_name, org_number, invoice_address_line1, invoice_postal_code, invoice_city")
          .eq("id", legalEntityId)
          .maybeSingle();
        if (le) {
          legal = {
            legal_name: (le as any).legal_name ?? "",
            org_number: (le as any).org_number ?? "",
            invoice_address_line1: (le as any).invoice_address_line1 ?? null,
            invoice_postal_code: (le as any).invoice_postal_code ?? null,
            invoice_city: (le as any).invoice_city ?? null,
          };
        }
      }

      const lines: DeliveryNoteLine[] = ((data as any).delivery_note_lines ?? [])
        .map((l: any) => ({
          id: l.id,
          line_number: Number(l.line_number ?? 0),
          product_id: l.product_id,
          product_snapshot: l.product_snapshot,
          quantity: Number(l.quantity ?? 0),
          sales_unit: l.sales_unit ?? "",
          unit_price: Number(l.unit_price ?? 0),
          discount_percent: Number(l.discount_percent ?? 0),
          vat_rate: Number(l.vat_rate ?? 0),
          line_subtotal_excl_vat: Number(l.line_subtotal_excl_vat ?? 0),
          line_vat: Number(l.line_vat ?? 0),
          line_total_incl_vat: Number(l.line_total_incl_vat ?? 0),
          notes: l.notes ?? null,
          order_line_id: l.order_line_id ?? null,
          order_id: l.order_id ?? null,
        }))
        .sort((a, b) => a.line_number - b.line_number);

      return {
        id: (data as any).id,
        display_number: (data as any).display_number,
        delivery_date: (data as any).delivery_date,
        delivery_tour_id: (data as any).delivery_tour_id,
        route_label: (data as any).route_label,
        status: (data as any).status,
        customer_id: (data as any).customer_id,
        customer_snapshot: (data as any).customer_snapshot,
        delivery_address_snapshot: (data as any).delivery_address_snapshot,
        subtotal_excl_vat: Number((data as any).subtotal_excl_vat ?? 0),
        total_vat: Number((data as any).total_vat ?? 0),
        total_incl_vat: Number((data as any).total_incl_vat ?? 0),
        notes: (data as any).notes,
        legal_entity: legal,
        lines,
      };
    },
    staleTime: 10_000,
  });
}
