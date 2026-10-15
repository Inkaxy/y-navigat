import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Eksakt antall fakturaer med én serverstatus (avstemt/holdt utenfor). Feil = ukjent, aldri 0. */
async function countStatus(legalEntityId: string, status: "reconciled" | "excluded"): Promise<number> {
  const { count, error } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("legal_entity_id", legalEntityId)
    .eq("status", status);
  if (error) throw error;
  if (typeof count !== "number") throw new Error("Antallet kom ikke fra serveren");
  return count;
}

export function useArbeidStatusCounts(legalEntityId: string | null) {
  return useQuery({
    queryKey: ["fakturaer-arbeid-tellere", legalEntityId],
    enabled: !!legalEntityId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const id = legalEntityId as string;
      const [ferdig, utenfor] = await Promise.all([countStatus(id, "reconciled"), countStatus(id, "excluded")]);
      return { ferdig, utenfor };
    },
  });
}
