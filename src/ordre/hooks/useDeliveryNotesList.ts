import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { NULL_TOUR_KEY } from "@/ordre/hooks/useTourRunStatus";
import { fetchAllRows } from "@/lib/supabasePaging";
import { correctionFromDate } from "@/ordre/lib/pendingOrders";

export type DeliveryNotesListMode = "date" | "correction";

export type DeliveryNoteLineRow = {
  id: string;
  line_number: number;
  quantity: number;
  sales_unit: string;
  notes: string | null;
  product_id: string;
  product_snapshot: Record<string, unknown> | null;
  is_recurring: boolean;
};

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
  notes: string | null;
  /** Faktisk leveringsdato på pakkseddelen (YYYY-MM-DD). */
  delivery_date: string;
  /** "fast" hvis alle linjer kommer fra fastordre, ellers "datert" */
  source_kind: "fast" | "datert" | "mixed";
  lines: DeliveryNoteLineRow[];
};

export function useDeliveryNotesList(
  date: string,
  tourId: string,
  mode: DeliveryNotesListMode = "date",
) {
  return useQuery({
    queryKey: ["delivery-notes-list", date, tourId, mode],
    queryFn: async (): Promise<DeliveryNoteRow[]> => {
      const fromDate = mode === "correction" ? correctionFromDate(date) : date;
      const data = await fetchAllRows<any>((from, to) => {
        let q = supabase
          .from("delivery_notes")
          .select(
            "id, display_number, customer_id, customer_snapshot, delivery_tour_id, delivery_date, route_label, status, total_incl_vat, notes, delivery_note_lines(id, line_number, quantity, sales_unit, notes, product_id, product_snapshot, order:orders(recurring_schedule_id))"
          )
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
          .neq("status", "cancelled")
          // Returpakksedler hører hjemme under Retur, ikke i pakkseddel-lista.
          .eq("is_return", false)
          .gte("delivery_date", fromDate)
          .lte("delivery_date", date)
          .order("delivery_date", { ascending: true })
          .order("display_number", { ascending: true })
          .range(from, to);

        if (tourId === NULL_TOUR_KEY) q = q.is("delivery_tour_id", null);
        else if (tourId !== "all") q = q.eq("delivery_tour_id", tourId);

        return q as unknown as PromiseLike<{ data: any[] | null; error: { message: string } | null }>;
      });

      return (data as any[]).map((row) => {
        const rawLines = Array.isArray(row.delivery_note_lines) ? row.delivery_note_lines : [];
        const lines: DeliveryNoteLineRow[] = rawLines
          .map((l: any) => ({
            id: l.id,
            line_number: Number(l.line_number ?? 0),
            quantity: Number(l.quantity ?? 0),
            sales_unit: l.sales_unit ?? "",
            notes: l.notes ?? null,
            product_id: l.product_id,
            product_snapshot: l.product_snapshot ?? null,
            is_recurring: Boolean(l.order?.recurring_schedule_id),
          }))
          .sort((a: DeliveryNoteLineRow, b: DeliveryNoteLineRow) => a.line_number - b.line_number);

        let source_kind: "fast" | "datert" | "mixed" = "datert";
        if (lines.length > 0) {
          const recurring = lines.filter((l) => l.is_recurring).length;
          if (recurring === lines.length) source_kind = "fast";
          else if (recurring === 0) source_kind = "datert";
          else source_kind = "mixed";
        }

        return {
          id: row.id,
          display_number: row.display_number,
          customer_id: row.customer_id,
          customer_snapshot: row.customer_snapshot,
          delivery_tour_id: row.delivery_tour_id,
          route_label: row.route_label,
          status: row.status,
          total_incl_vat: Number(row.total_incl_vat ?? 0),
          line_count: lines.length,
          notes: row.notes ?? null,
          delivery_date: row.delivery_date as string,
          source_kind,
          lines,
        } satisfies DeliveryNoteRow;
      });
    },
    staleTime: 10_000,
  });
}
