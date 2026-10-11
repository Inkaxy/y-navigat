import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  correctionErrorMessage, parseCorrectionResult, parseReadIssues, type CorrectionField, type CorrectionValues,
} from "@/fakturaer/lib/lineCorrection";
import type { ReadIssue } from "@/fakturaer/lib/invoiceReadCheck";
import { invalidateInvoiceWork } from "./useInvoiceActions";

export type CorrectionLine = {
  id: string; invoice_id: string; line_number: number | null; updated_at: string;
  values: CorrectionValues; issues: ReadIssue[]; costPosted: boolean;
};

/** Ferske verdier for linjen (med versjon) — dialogen leser aldri fra en utdatert liste. */
export function useCorrectionLine(lineId: string | null) {
  return useQuery({
    queryKey: ["invoice-line-correction", lineId],
    enabled: !!lineId,
    staleTime: 0,
    queryFn: async (): Promise<CorrectionLine> => {
      const [line, posting] = await Promise.all([
        supabase.from("invoice_lines")
          .select("id, invoice_id, line_number, updated_at, supplier_sku, description, quantity, unit, package_size, package_unit, count_per_package, unit_price, total_amount, line_kind, unit_price_basis, discount_amount, extraction_issues")
          .eq("id", lineId as string).single(),
        supabase.from("invoice_line_cost_postings").select("invoice_line_id").eq("invoice_line_id", lineId as string).is("revoked_at", null).limit(1),
      ]);
      if (line.error) throw new Error("Kunne ikke hente linjen");
      if (posting.error) throw new Error("Kunne ikke hente kostprisføringen");
      const l = line.data;
      return {
        id: l.id, invoice_id: l.invoice_id, line_number: l.line_number, updated_at: l.updated_at ?? "",
        values: {
          supplier_sku: l.supplier_sku, description: l.description, quantity: l.quantity, unit: l.unit, package_size: l.package_size,
          package_unit: l.package_unit, count_per_package: l.count_per_package, unit_price: l.unit_price, total_amount: l.total_amount, line_kind: l.line_kind, unit_price_basis: l.unit_price_basis, discount_amount: l.discount_amount,
        },
        issues: parseReadIssues(l.extraction_issues),
        costPosted: (posting.data ?? []).length > 0,
      };
    },
  });
}

export type CorrectArgs = {
  lineId: string; invoiceId: string; expectedUpdatedAt: string;
  changes: Partial<Record<CorrectionField, string | number | null>>;
  reason: string; learn: boolean; acceptIssues: boolean;
};

export function useCorrectLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: CorrectArgs) => {
      const { data, error } = await supabase.rpc("rm_correct_invoice_line", {
        p_line_id: a.lineId, p_expected_updated_at: a.expectedUpdatedAt, p_changes: a.changes as Json,
        p_reason: a.reason, p_learn: a.learn, p_accept_issues: a.acceptIssues,
      });
      if (error) throw new Error(correctionErrorMessage(error.message));
      return parseCorrectionResult(data);
    },
    onSettled: (_d, _e, a) => {
      invalidateInvoiceWork(qc, a.invoiceId);
      void qc.invalidateQueries({ queryKey: ["invoice-line-correction", a.lineId] });
      void qc.invalidateQueries({ queryKey: ["extraction-examples"] });
      void qc.invalidateQueries({ queryKey: ["fakturaer-review-lines"] });
    },
  });
}

export type ExtractionExample = { id: string; description: string | null; sku: string | null; note: string | null; created_at: string; is_active: boolean; withIssues: boolean };

/** Læringseksempler for leverandøren (samme selskap via RLS). */
export function useExtractionExamples(supplierId: string | null) {
  return useQuery({
    queryKey: ["extraction-examples", supplierId],
    enabled: !!supplierId,
    queryFn: async (): Promise<ExtractionExample[]> => {
      const { data, error } = await supabase.from("invoice_extraction_examples")
        .select("id, corrected, note, created_at, is_active, accepted_issues")
        .eq("supplier_id", supplierId as string).order("created_at", { ascending: false }).limit(50);
      if (error) throw new Error("Kunne ikke hente læringseksemplene");
      return (data ?? []).map((e) => {
        const c = e.corrected && typeof e.corrected === "object" && !Array.isArray(e.corrected) ? e.corrected : {};
        const desc = "description" in c && typeof c.description === "string" ? c.description : null;
        const sku = "supplier_sku" in c && typeof c.supplier_sku === "string" ? c.supplier_sku : null;
        return { id: e.id, description: desc, sku, note: e.note, created_at: e.created_at, is_active: e.is_active, withIssues: Array.isArray(e.accepted_issues) && e.accepted_issues.length > 0 };
      });
    },
  });
}

export function useToggleExample() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { id: string; active: boolean; reason?: string }) => {
      const { error } = await supabase.rpc("rm_set_extraction_example_active", { p_example_id: a.id, p_active: a.active, p_reason: a.reason });
      if (error) {
        const m = error.message;
        throw new Error(/forbidden/.test(m) ? "Du mangler skrivetilgang til fakturaer."
          : /uavklart_eksempel/.test(m) ? "Eksempelet kan ikke slås på: tallene eller prisgrunnlaget er ikke avklart. Rett fakturalinjen og lagre et nytt eksempel."
          : /begrunnelse/.test(m) ? "Skriv hvordan du har kontrollert eksempelet mot originalen."
          : "Kunne ikke endre eksempelet.");
      }
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["extraction-examples"] }),
  });
}

/** Bekreft lesevarsler på fakturanivå (beløp endres ikke). */
export function useConfirmReadIssues() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { invoiceId: string; reason: string }) => {
      const { error } = await supabase.rpc("rm_confirm_invoice_read_issues", { p_invoice_id: a.invoiceId, p_reason: a.reason });
      if (error) throw new Error(correctionErrorMessage(error.message));
    },
    onSettled: (_d, _e, a) => invalidateInvoiceWork(qc, a.invoiceId),
  });
}
