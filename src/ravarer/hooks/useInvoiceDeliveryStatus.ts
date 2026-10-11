import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";
import type { DeliveryExtras } from "@/ravarer/pages/priskontroll/faktura/invoiceSteps";

export type DeliveryExtrasMap = ReadonlyMap<string, DeliveryExtras>;

const EMPTY: DeliveryExtras = { approved: false, costPosted: false };

export function extrasFor(map: DeliveryExtrasMap | undefined, id: string): DeliveryExtras {
  return map?.get(id) ?? EMPTY;
}

/**
 * Godkjenning og kostprisføring for fakturaene på siden — én spørring hver,
 * aldri én per rad.
 */
export function useInvoiceDeliveryStatus(ids: readonly string[]) {
  const sorted = [...ids].sort();
  return useQuery({
    queryKey: ["invoice-delivery-status", sorted],
    enabled: sorted.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<DeliveryExtrasMap> => {
      // Kostprisføringer er per linje og kan passere API-ets grense på 1000 rader:
      // hent side for side og dedupliser, så ingen faktura mister «Kostpris ført».
      const [appr, cost] = await Promise.all([
        fetchAllRows<{ invoice_id: string }>((from, to) =>
          supabase.from("invoice_internal_approvals").select("invoice_id").in("invoice_id", sorted).eq("status", "approved").order("invoice_id").range(from, to)),
        fetchAllRows<{ invoice_id: string }>((from, to) =>
          supabase.from("invoice_line_cost_postings").select("invoice_id").in("invoice_id", sorted).is("revoked_at", null).order("invoice_id").range(from, to)),
      ]);
      const approved = new Set(appr.map((r) => r.invoice_id));
      const posted = new Set(cost.map((r) => r.invoice_id));
      const out = new Map<string, DeliveryExtras>();
      for (const id of sorted) out.set(id, { approved: approved.has(id), costPosted: posted.has(id) });
      return out;
    },
  });
}
