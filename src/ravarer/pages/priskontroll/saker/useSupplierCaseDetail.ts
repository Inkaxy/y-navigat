import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { creditNetExclVat, remainingByInvoice } from "@/fakturaer/lib/supplierCases";

type Basis = { price_per_base_unit?: number | null; expected_price_per_base_unit?: number | null; base_quantity?: number | null };

function parseBasis(v: unknown): Basis {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const n = (x: unknown) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
  return { price_per_base_unit: n(o.price_per_base_unit), expected_price_per_base_unit: n(o.expected_price_per_base_unit), base_quantity: n(o.base_quantity) };
}

/** Én sak med linjer, fordelinger og leverandørens kreditnotaer. */
export function useSupplierCaseDetail(id: string | null) {
  return useQuery({
    queryKey: ["supplier-case", id],
    enabled: !!id,
    queryFn: async () => {
      const { data: c, error } = await supabase
        .from("supplier_deviation_cases")
        .select("id, legal_entity_id, supplier_id, title, reason, status, follow_up_on, resolution_note, responsible_user_id, created_at, supplier:suppliers(name)")
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw error;
      if (!c) return null;
      const [lines, credits, notes] = await Promise.all([
        supabase.from("supplier_deviation_case_lines")
          .select("id, invoice_id, invoice_line_id, amount_excl_vat, basis, invoice:invoices(invoice_number), line:invoice_lines(description, supplier_sku, quantity, unit, unit_price, raw_material:raw_materials(name))")
          .eq("case_id", c.id).limit(500),
        supabase.from("supplier_deviation_credits")
          .select("id, invoice_id, credit_invoice_id, amount_excl_vat, note, created_at, credit:invoices!supplier_deviation_credits_credit_invoice_id_fkey(invoice_number)")
          .eq("case_id", c.id).limit(500),
        supabase.from("invoices").select("id, invoice_number, invoice_date, total_amount, total_vat")
          .eq("supplier_id", c.supplier_id).eq("legal_entity_id", c.legal_entity_id).eq("is_credit_note", true)
          .order("invoice_date", { ascending: false }).limit(100),
      ]);
      for (const r of [lines, credits, notes]) if (r.error) throw r.error;
      const noteIds = (notes.data ?? []).map((n) => n.id);
      const used = noteIds.length
        ? await supabase.from("supplier_deviation_credits").select("credit_invoice_id, amount_excl_vat").in("credit_invoice_id", noteIds).limit(1000)
        : { data: [], error: null };
      if (used.error) throw used.error;
      const lineRows = (lines.data ?? []).map((l) => ({ ...l, basis: parseBasis(l.basis), amount_excl_vat: Number(l.amount_excl_vat) }));
      const creditRows = (credits.data ?? []).map((x) => ({ ...x, amount_excl_vat: Number(x.amount_excl_vat) }));
      const usedRows = used.data ?? [];
      const unallocated = (noteId: string): number => {
        const n = (notes.data ?? []).find((x) => x.id === noteId);
        if (!n) return 0;
        // Ukjent mva gir ingen kapasitet — samme regel som serveren.
        const total = creditNetExclVat(n.total_amount, n.total_vat) ?? 0;
        const u = usedRows.filter((x) => x.credit_invoice_id === noteId).reduce((s, x) => s + Number(x.amount_excl_vat), 0);
        return Math.round((total - u) * 100) / 100;
      };
      return {
        c, lines: lineRows, credits: creditRows, notes: notes.data ?? [], unallocated,
        remaining: remainingByInvoice(lineRows, creditRows),
      };
    },
  });
}

export type SupplierCaseData = NonNullable<ReturnType<typeof useSupplierCaseDetail>["data"]>;
