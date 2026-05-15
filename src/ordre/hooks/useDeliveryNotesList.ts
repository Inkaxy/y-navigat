import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { NULL_TOUR_KEY } from "@/ordre/hooks/useTourRunStatus";

export type DeliveryNoteRow = {
  id: string;
  display_number: string;
  customer_id: string;
  customer_snapshot: Record<string, unknown> | null;
  delivery_tour_id: string | null;
  route_label: string | null;
  status: string;
  total_incl_vat: number;
  line_count: number;
};

export function useDeliveryNotesList(date: string, tourId: string) {
  return useQuery({
    queryKey: ["delivery-notes-list", date, tourId],
    queryFn: async (): Promise<DeliveryNoteRow[]> => {
      let q = supabase
        .from("delivery_notes")
        .select(
          "id, display_number, customer_id, customer_snapshot, delivery_tour_id, route_label, status, total_incl_vat, delivery_note_lines(id)"
        )
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("delivery_date", date)
        .neq("status", "cancelled")
        .order("display_number", { ascending: true });

      if (tourId === NULL_TOUR_KEY) q = q.is("delivery_tour_id", null);
      else if (tourId !== "all") q = q.eq("delivery_tour_id", tourId);

      const { data, error } = await q;
      if (error) throw error;

      return (data ?? []).map((row: any) => ({
        id: row.id,
        display_number: row.display_number,
        customer_id: row.customer_id,
        customer_snapshot: row.customer_snapshot,
        delivery_tour_id: row.delivery_tour_id,
        route_label: row.route_label,
        status: row.status,
        total_incl_vat: Number(row.total_incl_vat ?? 0),
        line_count: Array.isArray(row.delivery_note_lines) ? row.delivery_note_lines.length : 0,
      }));
    },
    staleTime: 10_000,
  });
}
