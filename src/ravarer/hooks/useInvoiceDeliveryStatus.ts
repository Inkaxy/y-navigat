import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";
import { extrasFromCounts, type DeliveryExtras } from "@/ravarer/pages/priskontroll/faktura/invoiceSteps";

export type DeliveryExtrasMap = ReadonlyMap<string, DeliveryExtras>;

const EMPTY: DeliveryExtras = { approved: false, costPosted: false, known: false };

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
    queryFn: () => fetchDeliveryExtras(supabase, sorted),
  });
}

type Db = Pick<typeof supabase, "from">;

/** Godkjenning (bare aktiv: status=approved og ikke tilbakekalt) og kostføring per faktura. */
export async function fetchDeliveryExtras(db: Db, sorted: readonly string[]): Promise<DeliveryExtrasMap> {
    {
      // Kostprisføringer er per linje og kan passere API-ets grense på 1000 rader:
      // hent side for side og dedupliser, så ingen faktura mister «Kostpris ført».
      const [appr, cost, lines] = await Promise.all([
        fetchAllRows<{ invoice_id: string }>((from, to) =>
          db.from("invoice_internal_approvals").select("invoice_id").in("invoice_id", sorted).eq("status", "approved").is("revoked_at", null).order("invoice_id").range(from, to)),
        fetchAllRows<{ invoice_id: string }>((from, to) =>
          db.from("invoice_line_cost_postings").select("invoice_id").in("invoice_id", sorted).is("revoked_at", null).order("invoice_id").range(from, to)),
        fetchAllRows<{ invoice_id: string }>((from, to) =>
          db.from("invoice_lines").select("invoice_id").in("invoice_id", sorted).or("match_confidence.is.null,match_confidence.neq.not_applicable").order("id").range(from, to)),
      ]);
      const approved = new Set(appr.map((r) => r.invoice_id));
      const count = (rows: { invoice_id: string }[]) => {
        const m = new Map<string, number>();
        for (const r of rows) m.set(r.invoice_id, (m.get(r.invoice_id) ?? 0) + 1);
        return m;
      };
      const posted = count(cost);
      const total = count(lines);
      const out = new Map<string, DeliveryExtras>();
      // Delvis føring er IKKE ferdig: «Kostpris ført» krever alle varelinjer.
      for (const id of sorted) out.set(id, extrasFromCounts(approved.has(id), posted.get(id) ?? 0, total.get(id) ?? 0));
      return out;
    }
}
