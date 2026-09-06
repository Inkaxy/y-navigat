import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { toast } from "sonner";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";

export interface ReceiptInvoiceRow {
  id: string;
  invoice_number: string;
  invoice_date: string;
  status: string;
  supplier_id: string | null;
  supplier_name: string | null;
  total_amount: number | null;
  /** Antall linjer med lagerbevegelse ('purchase' mot invoice_lines). */
  received_lines: number;
  /** Lagerførte varer uten bevegelse — typisk fordi base_quantity mangler. */
  missing_lines: number;
  /** Linjer som gjelder varer uten lagerføring. */
  untracked_lines: number;
  total_lines: number;
}

export interface ReceiptLine {
  id: string;
  line_number: number | null;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  base_quantity: number | null;
  total_amount: number | null;
  raw_material_id: string | null;
  raw_material_name: string | null;
  base_unit: string | null;
  stock_tracking: boolean;
  /** Sum av 'purchase'-bevegelser knyttet til linja. */
  received_base: number | null;
  has_movement: boolean;
}

interface InvoiceFilters {
  fromDate: string;
  toDate: string;
  supplierId?: string | null;
}

interface RawLine {
  id: string;
  invoice_id: string;
  line_number: number | null;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  base_quantity: number | null;
  total_amount: number | null;
  raw_material_id: string | null;
  raw_materials: { id: string; name: string; base_unit: string; stock_tracking: boolean } | null;
}

/** Fakturaer i perioden med mottaksstatus per faktura. */
export function useReceiptInvoices(filters: InvoiceFilters) {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["receipt-invoices", legalEntityId, filters.fromDate, filters.toDate, filters.supplierId ?? null],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<ReceiptInvoiceRow[]> => {
      let q = supabase
        .from("invoices")
        .select("id, invoice_number, invoice_date, status, supplier_id, total_amount, suppliers(name)")
        .eq("legal_entity_id", legalEntityId!)
        .in("status", ["ready", "reconciled"])
        .gte("invoice_date", filters.fromDate)
        .lte("invoice_date", filters.toDate)
        .order("invoice_date", { ascending: false })
        .limit(200);
      if (filters.supplierId) q = q.eq("supplier_id", filters.supplierId);
      const { data: invoices, error } = await q;
      if (error) throw error;

      const ids = (invoices ?? []).map(i => i.id);
      if (ids.length === 0) return [];

      const { data: lines, error: lineErr } = await supabase
        .from("invoice_lines")
        .select("id, invoice_id, base_quantity, raw_material_id, raw_materials(stock_tracking)")
        .in("invoice_id", ids);
      if (lineErr) throw lineErr;

      const lineIds = (lines ?? []).map(l => l.id);
      const movedLineIds = new Set<string>();
      if (lineIds.length > 0) {
        const { data: movements } = await supabase
          .from("stock_movements")
          .select("source_id")
          .eq("source_table", "invoice_lines")
          .eq("movement_type", "purchase")
          .in("source_id", lineIds);
        (movements ?? []).forEach(m => m.source_id && movedLineIds.add(m.source_id));
      }

      return (invoices ?? []).map(inv => {
        const mine = (lines ?? []).filter(l => l.invoice_id === inv.id);
        let received = 0;
        let missing = 0;
        let untracked = 0;
        for (const l of mine) {
          const tracked = !!(l.raw_materials as { stock_tracking: boolean } | null)?.stock_tracking;
          if (!tracked) untracked++;
          else if (movedLineIds.has(l.id)) received++;
          else missing++;
        }
        return {
          id: inv.id,
          invoice_number: inv.invoice_number,
          invoice_date: inv.invoice_date,
          status: inv.status,
          supplier_id: inv.supplier_id,
          supplier_name: (inv.suppliers as { name: string } | null)?.name ?? null,
          total_amount: inv.total_amount == null ? null : Number(inv.total_amount),
          received_lines: received,
          missing_lines: missing,
          untracked_lines: untracked,
          total_lines: mine.length,
        };
      });
    },
  });
}

/** Linjene på én faktura med mottatt mengde per linje. */
export function useReceiptLines(invoiceId: string | undefined) {
  return useQuery({
    queryKey: ["receipt-lines", invoiceId],
    enabled: !!invoiceId,
    queryFn: async (): Promise<ReceiptLine[]> => {
      const { data, error } = await supabase
        .from("invoice_lines")
        .select(
          "id, invoice_id, line_number, description, quantity, unit, base_quantity, total_amount, raw_material_id, raw_materials(id, name, base_unit, stock_tracking)",
        )
        .eq("invoice_id", invoiceId!)
        .order("line_number");
      if (error) throw error;
      const rows = (data ?? []) as unknown as RawLine[];

      const receivedByLine = new Map<string, number>();
      if (rows.length > 0) {
        const { data: movements } = await supabase
          .from("stock_movements")
          .select("source_id, quantity_base")
          .eq("source_table", "invoice_lines")
          .eq("movement_type", "purchase")
          .in("source_id", rows.map(r => r.id));
        (movements ?? []).forEach(m => {
          if (!m.source_id) return;
          receivedByLine.set(m.source_id, (receivedByLine.get(m.source_id) ?? 0) + (Number(m.quantity_base) || 0));
        });
      }

      return rows.map(r => ({
        id: r.id,
        line_number: r.line_number,
        description: r.description,
        quantity: r.quantity == null ? null : Number(r.quantity),
        unit: r.unit,
        base_quantity: r.base_quantity == null ? null : Number(r.base_quantity),
        total_amount: r.total_amount == null ? null : Number(r.total_amount),
        raw_material_id: r.raw_material_id,
        raw_material_name: r.raw_materials?.name ?? null,
        base_unit: r.raw_materials?.base_unit ?? null,
        stock_tracking: !!r.raw_materials?.stock_tracking,
        received_base: receivedByLine.has(r.id) ? receivedByLine.get(r.id)! : null,
        has_movement: receivedByLine.has(r.id),
      }));
    },
  });
}

export interface ReceiptMovementInput {
  raw_material_id: string;
  /** Positiv = mottok mer, negativ = mottok mindre. Svinn sendes som positivt tall med kind 'waste'. */
  quantity_base: number;
  kind: "adjustment" | "waste" | "purchase";
  note: string;
  occurred_at?: string;
}

/** Skriver en mottaksbevegelse (avvik, svinn eller manuelt mottak). */
export function useReceiptMovement() {
  const qc = useQueryClient();
  const { legalEntityId, user } = useRavarer();
  return useMutation({
    mutationFn: async (input: ReceiptMovementInput) => {
      const quantity = input.kind === "waste" ? -Math.abs(input.quantity_base) : input.quantity_base;
      const { error } = await supabase.from("stock_movements").insert({
        legal_entity_id: legalEntityId,
        raw_material_id: input.raw_material_id,
        movement_type: input.kind,
        quantity_base: quantity,
        note: input.note,
        occurred_at: input.occurred_at ?? new Date().toISOString(),
        source_table: "manual",
        source_id: crypto.randomUUID(),
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidateRawMaterial(qc, vars.raw_material_id);
      toast.success("Bevegelse registrert");
    },
    onError: (e: unknown) => toast.error(`Kunne ikke registrere: ${e instanceof Error ? e.message : String(e)}`),
  });
}
