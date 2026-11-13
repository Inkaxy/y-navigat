import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { UsageLogRow } from "@/fakturaer/lib/aiFailure";
import { AI_FAILURE_PREFIX } from "@/fakturaer/lib/aiFailure";
import { invoiceReadingHealth, type InvoiceAiErrorRow, type ReadingHealth } from "@/ravarer/lib/invoiceReadingHealth";

/**
 * Lesestatus for fakturalesingen. Bruksloggen er bare lesbar for plattformadministrator (RLS);
 * andre får signalet fra fakturaer som venter med AI-feiltekst i eget selskap.
 */
export function useInvoiceReadingHealth(legalEntityId: string | null, enabled = true) {
  return useQuery<ReadingHealth>({
    queryKey: ["invoice-reading-health", legalEntityId],
    enabled: enabled && !!legalEntityId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const [usageR, okR, invR, invOkR] = await Promise.all([
        supabase.from("ai_usage_log").select("created_at, success, error_message")
          .eq("purpose", "invoice_extraction").order("created_at", { ascending: false }).limit(50),
        supabase.from("ai_usage_log").select("created_at")
          .eq("purpose", "invoice_extraction").eq("success", true).order("created_at", { ascending: false }).limit(1),
        supabase.from("invoices").select("line_extraction_error, line_extraction_at")
          .eq("legal_entity_id", legalEntityId!)
          .in("line_extraction_status", ["pending", "failed"])
          .like("line_extraction_error", `%${AI_FAILURE_PREFIX}%`)
          .order("line_extraction_at", { ascending: false }).limit(200),
        supabase.from("invoices").select("line_extraction_at")
          .eq("legal_entity_id", legalEntityId!).eq("line_extraction_status", "done").eq("lines_sum_status", "ok")
          .not("line_extraction_at", "is", null)
          .order("line_extraction_at", { ascending: false }).limit(1),
      ]);
      const usage: UsageLogRow[] | null = usageR.error ? null : ((usageR.data ?? []) as UsageLogRow[]);
      const invoices: InvoiceAiErrorRow[] | null = invR.error ? null : ((invR.data ?? []) as InvoiceAiErrorRow[]);
      const lastOkLog = okR.error ? null : (okR.data?.[0]?.created_at ?? null);
      const lastOkInvoice = invOkR.error ? null : (invOkR.data?.[0]?.line_extraction_at ?? null);
      return invoiceReadingHealth({ usage, lastSuccessAt: lastOkLog ?? lastOkInvoice, aiErrorInvoices: invoices });
    },
  });
}
