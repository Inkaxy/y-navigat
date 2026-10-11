import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unflagInvoice } from "@/fakturaer/lib/queueActions";
import { invalidateInvoice, invalidateRavarerCounts } from "@/ravarer/lib/invalidate";

function invalidate(qc: ReturnType<typeof useQueryClient>, id?: string) {
  invalidateInvoice(qc, id);
  invalidateRavarerCounts(qc);
  void qc.invalidateQueries({ queryKey: ["fakturaer-inbox"] });
  void qc.invalidateQueries({ queryKey: ["fakturaer-liste"] });
  void qc.invalidateQueries({ queryKey: ["invoice-delivery-status"] });
}

/** «Hent linjer» fra Tripletex — bare for Tripletex-fakturaer. */
export function useFetchInvoiceLines() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inv: { id: string; legal_entity_id: string; source: string | null }) => {
      if (inv.source !== "tripletex") throw new Error("Linjer kan bare hentes for Tripletex-fakturaer.");
      const { data, error } = await supabase.functions.invoke<{ feilet?: number }>("tripletex-import-invoice-lines", {
        body: { legal_entity_id: inv.legal_entity_id, invoice_id: inv.id, limit: 1 },
      });
      if (error) {
        console.error("[hent-linjer]", error);
        throw new Error("Linjene kunne ikke hentes. Prøv igjen.");
      }
      if (Number(data?.feilet ?? 0) > 0) throw new Error("Linjene kunne ikke hentes fra fakturaen.");
      return true;
    },
    onSuccess: (_r, inv) => invalidate(qc, inv.id),
  });
}

export function useUnflagInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        await unflagInvoice(id);
      } catch (e) {
        console.error("[fjern-flagg]", e);
        throw new Error("Kunne ikke fjerne flagget. Prøv igjen.");
      }
      return id;
    },
    onSuccess: (id) => invalidate(qc, id),
  });
}

export { invalidate as invalidateInvoiceWork };
