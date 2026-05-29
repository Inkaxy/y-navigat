import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseMerknad, type Merknad } from "@/ordre/lib/merknad";

/**
 * Henter merknad-feltet for et sett av order_lines.
 * Returnerer Record<order_line_id, Merknad | null>.
 */
export function useOrderLineMerknads(orderLineIds: string[] | undefined) {
  const ids = (orderLineIds ?? []).filter(Boolean).slice().sort();
  return useQuery({
    queryKey: ["order_line_merknads", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Record<string, Merknad | null>> => {
      const { data, error } = await supabase
        .from("order_lines")
        .select("id, merknad")
        .in("id", ids);
      if (error) throw error;
      const out: Record<string, Merknad | null> = {};
      for (const id of ids) out[id] = null;
      for (const row of data ?? []) {
        out[(row as { id: string }).id] = parseMerknad(
          (row as { merknad: unknown }).merknad,
        );
      }
      return out;
    },
    staleTime: 30_000,
  });
}

/** Synkron helper for å hente flere merknad-records på en gang utenfor React. */
export async function fetchOrderLineMerknads(
  orderLineIds: string[],
): Promise<Record<string, Merknad | null>> {
  const ids = orderLineIds.filter(Boolean);
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from("order_lines")
    .select("id, merknad")
    .in("id", ids);
  if (error) throw error;
  const out: Record<string, Merknad | null> = {};
  for (const id of ids) out[id] = null;
  for (const row of data ?? []) {
    out[(row as { id: string }).id] = parseMerknad(
      (row as { merknad: unknown }).merknad,
    );
  }
  return out;
}
