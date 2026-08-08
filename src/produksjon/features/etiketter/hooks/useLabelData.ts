import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Én ordrelinje med ferdig oppløste etikettverdier fra RPC `resolve_label_data`. */
export interface LabelData {
  /** Verdier per feltnøkkel fra `label_field_catalog`. */
  felter: Record<string, unknown>;
  /** Felter som profilen kan skrive ut, men som mangler verdi. */
  mangler: string[];
}

export type LabelDataMap = Record<string, LabelData | null>;

function toMap(ids: string[], rows: unknown): LabelDataMap {
  const out: LabelDataMap = {};
  for (const id of ids) out[id] = null;
  for (const raw of (rows as Array<Record<string, unknown>>) ?? []) {
    const id = raw.order_line_id as string;
    if (!id) continue;
    const felter = (raw.felter ?? {}) as Record<string, unknown>;
    out[id] = {
      felter: typeof felter === "object" && felter !== null ? felter : {},
      mangler: (raw.mangler as string[] | null) ?? [],
    };
  }
  return out;
}

/** Henter etikettdata for et sett ordrelinjer utenfor React. */
export async function fetchLabelData(
  orderLineIds: string[],
): Promise<LabelDataMap> {
  const ids = orderLineIds.filter(Boolean);
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc("resolve_label_data", {
    p_order_line_ids: ids,
  });
  if (error) throw error;
  return toMap(ids, data);
}

export function useLabelData(orderLineIds: string[] | undefined) {
  const ids = (orderLineIds ?? []).filter(Boolean).slice().sort();
  return useQuery({
    queryKey: ["resolve_label_data", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: () => fetchLabelData(ids),
    staleTime: 30_000,
  });
}
