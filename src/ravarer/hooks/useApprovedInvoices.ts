import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";

/** Hvilke av fakturaene som er godkjent internt (aktiv godkjenning). Linjene der kan ikke kobles. */
export function useApprovedInvoiceIds(invoiceIds: readonly string[]) {
  const key = [...new Set(invoiceIds)].sort().join("|");
  const sorted = useMemo(() => (key ? key.split("|") : []), [key]);
  return useQuery({
    queryKey: ["invoice-approved-ids", sorted],
    enabled: sorted.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<Set<string>> => {
      const rows = await fetchAllRows<{ invoice_id: string }>((from, to) =>
        supabase.from("invoice_internal_approvals").select("invoice_id").in("invoice_id", sorted).eq("status", "approved").is("revoked_at", null).order("invoice_id").range(from, to));
      return new Set(rows.map((r) => r.invoice_id));
    },
  });
}
