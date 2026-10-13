import { useQuery } from "@tanstack/react-query";
import { QueryState } from "@/components/common/QueryState";
import { supabase } from "@/integrations/supabase/client";
import { fetchInvoiceDetail } from "@/fakturaer/components/invoice-detail/fetchInvoiceDetail";
import { InvoiceDocumentPanel } from "@/fakturaer/components/InvoiceDocumentPanel";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";

/** Fakturaen originalen hører til: fakturasaken selv, ellers fakturaen til varekortets siste åpne linje. */
function useOriginalInvoiceId(item: WorkItem): { id: string | null; loading: boolean; error: unknown } {
  const lineId = item.invoice_id ? null : item.last_open_line_id;
  const q = useQuery({
    queryKey: ["arbeidsbord", "line-invoice", lineId],
    enabled: !!lineId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("invoice_lines").select("invoice_id").eq("id", lineId as string).maybeSingle();
      if (error) throw error;
      return data?.invoice_id ?? null;
    },
  });
  if (item.invoice_id) return { id: item.invoice_id, loading: false, error: null };
  return { id: q.data ?? null, loading: q.isLoading && !!lineId, error: q.error };
}

/** Originaldokumentet i samme arbeidsflate — gjenbruker fakturaens dokumentpanel med fersk identitetskontroll. */
export function OriginalPane({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  const target = useOriginalInvoiceId(item);
  const detail = useQuery({ queryKey: ["invoice", target.id], enabled: !!target.id, queryFn: () => fetchInvoiceDetail(target.id as string) });
  if (!target.loading && !target.error && !target.id) {
    return <p className="rounded-xl border border-line-subtle bg-card p-4 text-sm text-ink-secondary">Ingen åpen fakturalinje å vise originalen for.</p>;
  }
  const d = detail.data;
  if (!d) {
    return (
      <QueryState scope="arbeidsbord:original" isLoading={target.loading || detail.isLoading} isError={!!target.error || detail.isError} error={target.error ?? detail.error} onRetry={() => void detail.refetch()}>
        {null}
      </QueryState>
    );
  }
  const line = (d.invoice_lines ?? []).find((l) => l.id === item.last_open_line_id) ?? null;
  return (
    <InvoiceDocumentPanel
      invoiceId={d.id}
      invoice={{ invoice_number: d.invoice_number, invoice_date: d.invoice_date, supplier_name: d.suppliers?.name ?? null, source_document_url: d.source_document_url, total_amount: d.total_amount, total_vat: d.total_vat, lines_sum_status: d.lines_sum_status, lines_sum_excl_vat: d.lines_sum_excl_vat, lines_sum_variance_pct: d.lines_sum_variance_pct, extraction_confidence: d.extraction_confidence, currency: d.currency, is_credit_note: d.is_credit_note, flagged_at: d.flagged_at, extraction_issues: d.extraction_issues }}
      line={line ? { description: line.description, supplier_sku: line.supplier_sku, quantity: line.quantity, unit: line.unit, unit_price: line.unit_price, total_amount: line.total_amount, package_size: line.package_size, package_unit: line.package_unit, count_per_package: line.count_per_package, extraction_issues: line.extraction_issues } : null}
      onClose={onClose}
      className="h-[70vh] xl:h-[calc(100vh-12rem)]"
    />
  );
}
