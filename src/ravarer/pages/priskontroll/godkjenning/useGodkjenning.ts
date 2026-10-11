import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchApprovalOverview, type OverviewRow } from "@/fakturaer/lib/approval";
import { deliverySteps, type DeliveryStep } from "@/ravarer/pages/priskontroll/faktura/invoiceSteps";

export type ApprovalDelivery = {
  received_at: string | null;
  lines_sum_status: string | null;
  reconciled_mode: string | null;
  line_extraction_status: string | null;
  lines_source: string | null;
  flagged: boolean;
  line_count: number;
};

export function useApprovalOverview(legalEntityId: string | null) {
  return useQuery({
    queryKey: ["invoice-approval-overview", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: () => fetchApprovalOverview(legalEntityId as string),
  });
}

/** Feltene leveransestatusen trenger for fakturaene på siden — én spørring. */
export function useApprovalDelivery(ids: readonly string[]) {
  const sorted = [...ids].sort();
  return useQuery({
    queryKey: ["approval-delivery", sorted],
    enabled: sorted.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<ReadonlyMap<string, ApprovalDelivery>> => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, imported_at, created_at, lines_sum_status, reconciled_mode, line_extraction_status, lines_source, flagged_at, invoice_lines(count)")
        .in("id", sorted)
        .limit(sorted.length);
      if (error) throw error;
      const m = new Map<string, ApprovalDelivery>();
      for (const r of data ?? []) {
        m.set(r.id, {
          received_at: r.imported_at ?? r.created_at, lines_sum_status: r.lines_sum_status, reconciled_mode: r.reconciled_mode,
          line_extraction_status: r.line_extraction_status, lines_source: r.lines_source, flagged: !!r.flagged_at,
          line_count: r.invoice_lines?.[0]?.count ?? 0,
        });
      }
      return m;
    },
  });
}

/** Samme tidslinje som Fakturaer-fanen: godkjenning og kostpris kommer fra oversikten. */
export function approvalSteps(r: OverviewRow, d: ApprovalDelivery | undefined): DeliveryStep[] {
  return deliverySteps(
    {
      status: r.status ?? "", received_at: d?.received_at ?? null, line_count: d?.line_count ?? 0, lines_source: d?.lines_source ?? null,
      line_extraction_status: d?.line_extraction_status ?? null, open_count: r.open_material_lines,
      lines_sum_status: d?.lines_sum_status ?? null, reconciled_mode: d?.reconciled_mode ?? null,
      is_credit_note: r.is_credit_note,
    },
    { approved: !!r.approved_at, costPosted: r.cost_posted_lines > 0 },
  );
}
