import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Ferdig oppløste etikettfelter for én ordrelinje (fra RPC `resolve_label_fields`). */
export interface LabelFields {
  fyll: string | null;
  pynt: string | null;
  tekst: string | null;
  sukkerbilde: boolean | null;
  bestilt_av: string | null;
  kommentar: string | null;
  /** Felter profilen skriver ut, men som mangler verdi. */
  mangler: string[];
  /** Nøkler i notatfeltet funksjonen ikke forsto. */
  ukjente_nokler: string[];
}

export type LabelFieldsMap = Record<string, LabelFields | null>;

function toMap(ids: string[], rows: unknown): LabelFieldsMap {
  const out: LabelFieldsMap = {};
  for (const id of ids) out[id] = null;
  for (const raw of (rows as Array<Record<string, unknown>>) ?? []) {
    const id = raw.order_line_id as string;
    if (!id) continue;
    out[id] = {
      fyll: (raw.fyll as string | null) ?? null,
      pynt: (raw.pynt as string | null) ?? null,
      tekst: (raw.tekst as string | null) ?? null,
      sukkerbilde: (raw.sukkerbilde as boolean | null) ?? null,
      bestilt_av: (raw.bestilt_av as string | null) ?? null,
      kommentar: (raw.kommentar as string | null) ?? null,
      mangler: (raw.mangler as string[] | null) ?? [],
      ukjente_nokler: (raw.ukjente_nokler as string[] | null) ?? [],
    };
  }
  return out;
}

/** Henter etikettfelter for et sett ordrelinjer utenfor React. */
export async function fetchLabelFields(
  orderLineIds: string[],
): Promise<LabelFieldsMap> {
  const ids = orderLineIds.filter(Boolean);
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc("resolve_label_fields", {
    p_order_line_ids: ids,
  });
  if (error) throw error;
  return toMap(ids, data);
}

export function useLabelFields(orderLineIds: string[] | undefined) {
  const ids = (orderLineIds ?? []).filter(Boolean).slice().sort();
  return useQuery({
    queryKey: ["resolve_label_fields", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: () => fetchLabelFields(ids),
    staleTime: 30_000,
  });
}
