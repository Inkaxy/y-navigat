import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { fetchPendingReturnNotesCount } from "@/ordre/lib/pendingOrders";

export type ReturnTab = "pending" | "approved" | "rejected";

export type ReturnNoteRow = {
  id: string;
  display_number: string;
  status: string;
  delivery_date: string;
  created_at: string;
  notes: string | null;
  total_incl_vat: number;
  approved_at: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
  return_order_id: string | null;
  customer_name: string;
  order_number: string | null;
  line_count: number;
};

export type ReturnNoteLine = {
  id: string;
  line_number: number;
  product_name: string;
  sales_unit: string;
  quantity: number;
  received_quantity: number | null;
  unit_price: number;
  vat_rate: number;
};

// MERK: delivery_notes har ingen FK til customers, så customer-navnet kan ikke
// embeddes via PostgREST (det ga en 400 og en tom liste). Vi henter navnene i
// et separat oppslag og faller tilbake til customer_snapshot.
const SELECT =
  "id, display_number, status, delivery_date, created_at, notes, total_incl_vat, " +
  "approved_at, rejected_at, rejected_reason, return_order_id, customer_id, customer_snapshot, " +
  "orders:return_order_id(order_number), delivery_note_lines(id)";

function customerNameOf(row: Record<string, unknown>, names: Map<string, string>): string {
  const byId = row.customer_id ? names.get(row.customer_id as string) : undefined;
  if (byId) return byId;
  const snap = (row.customer_snapshot ?? {}) as Record<string, unknown>;
  return (snap.name as string) ?? "Ukjent kunde";
}

export function useReturnDeliveryNotes(tab: ReturnTab, maxDate?: string) {
  return useQuery({
    queryKey: ["return-delivery-notes", tab, maxDate ?? null],
    queryFn: async (): Promise<ReturnNoteRow[]> => {
      let q = supabase
        .from("delivery_notes")
        .select(SELECT)
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("is_return", true);

      // Ventende returer følger «til dato»-logikken i korreksjonsvisningen:
      // alt som skal faktureres til og med valgt dato.
      if (tab === "pending") {
        if (maxDate) q = q.lte("delivery_date", maxDate);
        q = q
          .eq("status", "draft")
          .is("approved_at", null)
          .is("rejected_at", null)
          .order("created_at", { ascending: true });
      } else if (tab === "approved") {
        q = q.not("approved_at", "is", null).order("approved_at", { ascending: false });
      } else {
        q = q.eq("status", "cancelled").order("created_at", { ascending: false });
      }

      const { data, error } = await q.limit(500);
      if (error) throw error;

      const rows = (data ?? []) as unknown as Record<string, any>[];
      const customerIds = Array.from(
        new Set(rows.map((r) => r.customer_id).filter(Boolean) as string[]),
      );
      const names = new Map<string, string>();
      if (customerIds.length > 0) {
        const { data: cust } = await supabase
          .from("customers")
          .select("id, display_name")
          .in("id", customerIds);
        for (const c of (cust ?? []) as Array<{ id: string; display_name: string }>) {
          names.set(c.id, c.display_name);
        }
      }

      return rows.map((row) => ({
        id: row.id,
        display_number: row.display_number,
        status: row.status,
        delivery_date: row.delivery_date,
        created_at: row.created_at,
        notes: row.notes ?? null,
        total_incl_vat: Number(row.total_incl_vat ?? 0),
        approved_at: row.approved_at ?? null,
        rejected_at: row.rejected_at ?? null,
        rejected_reason: row.rejected_reason ?? null,
        return_order_id: row.return_order_id ?? null,
        customer_name: customerNameOf(row, names),
        order_number: row.orders?.order_number ?? null,
        line_count: Array.isArray(row.delivery_note_lines) ? row.delivery_note_lines.length : 0,
      }));
    },
    staleTime: 15_000,
  });
}


/** Antall returpakksedler som venter på godkjenning. */
export function usePendingReturnsCount(
  legalEntityId: string = NB_LEGAL_ENTITY_ID,
  maxDate?: string,
) {
  return useQuery({
    queryKey: ["return-delivery-notes", "pending-count", legalEntityId, maxDate ?? null],
    queryFn: () => fetchPendingReturnNotesCount(maxDate, legalEntityId),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useReturnNoteLines(noteId: string | undefined) {
  return useQuery({
    enabled: !!noteId,
    queryKey: ["return-delivery-note-lines", noteId],
    queryFn: async (): Promise<ReturnNoteLine[]> => {
      const { data, error } = await supabase
        .from("delivery_note_lines")
        .select(
          "id, line_number, quantity, received_quantity, unit_price, vat_rate, sales_unit, product_snapshot",
        )
        .eq("delivery_note_id", noteId!)
        .order("line_number", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, any>[]).map((l) => {
        const snap = (l.product_snapshot ?? {}) as Record<string, unknown>;
        return {
          id: l.id,
          line_number: Number(l.line_number ?? 0),
          product_name:
            (snap.name as string) ?? (snap.product_name as string) ?? "Ukjent vare",
          sales_unit: l.sales_unit ?? "",
          quantity: Number(l.quantity ?? 0),
          received_quantity:
            l.received_quantity === null || l.received_quantity === undefined
              ? null
              : Number(l.received_quantity),
          unit_price: Number(l.unit_price ?? 0),
          vat_rate: Number(l.vat_rate ?? 0),
        };
      });
    },
  });
}

function invalidateReturns(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["return-delivery-notes"] });
  qc.invalidateQueries({ queryKey: ["return-delivery-note-lines"] });
  qc.invalidateQueries({ queryKey: ["delivery-notes-list"] });
  qc.invalidateQueries({ queryKey: ["delivery-note-counts"] });
  qc.invalidateQueries({ queryKey: ["orders"] });
}

export type ApproveReturnResult = {
  ok?: boolean;
  lines_adjusted?: number;
  total_incl_vat?: number;
  status?: string;
};

export function useApproveReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      noteId: string;
      lines: { line_id: string; received_quantity: number }[];
      note?: string | null;
    }): Promise<ApproveReturnResult> => {
      const { data, error } = await supabase.rpc("approve_return_delivery_note", {
        p_note_id: args.noteId,
        p_lines: args.lines,
        p_note: args.note?.trim() ? args.note.trim() : undefined,
      });
      if (error) throw error;
      return (data ?? {}) as ApproveReturnResult;
    },
    onSuccess: () => invalidateReturns(qc),
  });
}

export function useRejectReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { noteId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("reject_return_delivery_note", {
        p_note_id: args.noteId,
        p_reason: args.reason,
      });
      if (error) throw error;
      return data as { ok?: boolean; status?: string };
    },
    onSuccess: () => invalidateReturns(qc),
  });
}
