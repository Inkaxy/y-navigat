import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useListPriceEvidence } from "@/ravarer/hooks/useListPriceEvidence";
import { latestInvoiceOf } from "@/ravarer/lib/listPriceEvidence";

export type SupplierLatest =
  | { kind: "loading" }
  | { kind: "error" }
  /** Siste faktura for råvaren er fra denne leverandøren og godkjent som prisgrunnlag. */
  | { kind: "price"; price: number; date: string | null; invoiceId: string; /** Enheten fra samme bevis som prisen. */ unit: string }
  /** Siste faktura er fra denne leverandøren, men prisen må kontrolleres. Ingen eldre pris brukes. */
  | { kind: "control"; date: string | null; invoiceId: string; reason: string | null }
  /** Leverandørens egen siste observasjon kan ikke bevises med dagens lesekontrakt. */
  | { kind: "unknown"; reason: string };

/**
 * Siste kjøp per koblet vare, avgrenset til leverandøren. Bygger på det samme råvarebeviset
 * (`rm_list_price_evidence`) og bekrefter at bevisets faktura tilhører leverandøren via én
 * batchet lesing av `invoices`. Er råvarens siste faktura fra en annen leverandør, er
 * leverandørens siste kjøp ukjent — vi viser aldri en annen leverandørs pris eller eldre pris.
 */
export function useSupplierLatestPurchase(legalEntityId: string | undefined, supplierId: string, materialIds: readonly string[]) {
  const ev = useListPriceEvidence(legalEntityId, materialIds, materialIds.length > 0);
  const invoiceIds = useMemo(() => {
    if (!ev.certified) return [];
    const s = new Set<string>();
    for (const e of ev.certified.byId.values()) if (e.invoiceId) s.add(e.invoiceId);
    return [...s].sort();
  }, [ev.certified]);
  const owners = useQuery({
    queryKey: ["supplier-latest-owner", legalEntityId, invoiceIds.join(",")],
    enabled: !!legalEntityId && invoiceIds.length > 0,
    queryFn: async () => {
      const map = new Map<string, string | null>();
      for (let i = 0; i < invoiceIds.length; i += 200) {
        const chunk = invoiceIds.slice(i, i + 200);
        const { data, error } = await supabase.from("invoices").select("id, supplier_id").eq("legal_entity_id", legalEntityId!).in("id", chunk).limit(chunk.length);
        if (error) throw error;
        for (const r of data ?? []) map.set(r.id, r.supplier_id);
      }
      return map;
    },
  });

  return (materialId: string): SupplierLatest => {
    if (ev.isError || owners.isError) return { kind: "error" };
    if (ev.loading || !ev.certified) return { kind: "loading" };
    const e = ev.certified.byId.get(materialId);
    if (!e || !e.invoiceId) return { kind: "unknown", reason: "Ingen kontrollert fakturaobservasjon" };
    if (owners.isLoading || owners.isFetching || !owners.data) return { kind: "loading" };
    if (!owners.data.has(e.invoiceId)) return { kind: "unknown", reason: "Fakturaen kunne ikke bekreftes" };
    if (owners.data.get(e.invoiceId) !== supplierId) {
      return { kind: "unknown", reason: "Siste kjøp av varen er fra en annen leverandør" };
    }
    const l = latestInvoiceOf(e);
    // Enheten må komme fra samme bevis som prisen; uten den holdes prisen tilbake.
    if (l.price != null && e.baseUnit) return { kind: "price", price: l.price, date: l.date, invoiceId: e.invoiceId, unit: e.baseUnit };
    if (l.price != null) return { kind: "control", date: l.date, invoiceId: e.invoiceId, reason: "Enheten for prisen er ukjent" };
    return { kind: "control", date: l.date, invoiceId: e.invoiceId, reason: l.reason };
  };
}
