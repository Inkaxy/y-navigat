import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type LabelUnitStatus = "reserved" | "printed" | "cancelled";

export interface LabelUnit {
  id: string;
  legal_entity_id: string;
  seq_date: string;
  number: number;
  unit_key: string;
  label_mode: string;
  product_id: string;
  order_id: string | null;
  order_line_id: string | null;
  unit_index: number | null;
  note_text: string | null;
  status: LabelUnitStatus;
  first_printed_at: string | null;
  print_count: number;
}

export const labelUnitsKey = (legalEntityId?: string, date?: string) =>
  ["label_units", legalEntityId ?? "none", date ?? "none"] as const;

/** Kjører `sync_label_numbers` for dagen — idempotent. */
export function useSyncLabelNumbers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { legalEntityId: string; date: string }) => {
      const { data, error } = await supabase.rpc("sync_label_numbers", {
        p_legal_entity_id: input.legalEntityId,
        p_date: input.date,
      } as never);
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { tildelt: number; kansellert: number; totalt: number }
        | undefined;
      return row ?? { tildelt: 0, kansellert: 0, totalt: 0 };
    },
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({
        queryKey: labelUnitsKey(vars.legalEntityId, vars.date),
      });
    },
  });
}

/** Alle etikett-enheter (numre) for selskap + dato, med realtime. */
export function useLabelUnits(legalEntityId?: string, date?: string) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!legalEntityId || !date) return;
    const ch = supabase
      .channel(`${legalEntityId}:label-units:${date}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "label_units",
          filter: `legal_entity_id=eq.${legalEntityId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: labelUnitsKey(legalEntityId, date) });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [legalEntityId, date, qc]);

  return useQuery({
    queryKey: labelUnitsKey(legalEntityId, date),
    enabled: !!legalEntityId && !!date,
    queryFn: async (): Promise<LabelUnit[]> => {
      const { data, error } = await supabase
        .from("label_units")
        .select("*")
        .eq("legal_entity_id", legalEntityId!)
        .eq("seq_date", date!)
        .order("number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as LabelUnit[];
    },
  });
}

export function groupUnitsByProduct(
  units: LabelUnit[] | undefined,
): Record<string, LabelUnit[]> {
  const out: Record<string, LabelUnit[]> = {};
  for (const u of units ?? []) {
    (out[u.product_id] ??= []).push(u);
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.number - b.number);
  return out;
}

/** «1–2, 7» av en liste tall. */
export function formatNumberRanges(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  if (sorted.length === 0) return "—";
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n !== prev + 1) {
      parts.push(start === prev ? String(start) : `${start}–${prev}`);
      start = n;
    }
    prev = n;
  }
  return parts.join(", ");
}

/** Numre som mangler i serien fordi etiketten er kansellert. */
export function cancelledGaps(units: LabelUnit[] | undefined): number[] {
  return (units ?? [])
    .filter((u) => u.status === "cancelled")
    .map((u) => u.number)
    .sort((a, b) => a - b);
}

/**
 * Marker etikett-enheter som skrevet ut: status='printed',
 * first_printed_at settes første gang, print_count telles opp.
 */
export async function markLabelUnitsPrinted(units: LabelUnit[]): Promise<void> {
  const now = new Date().toISOString();
  for (const u of units) {
    await supabase
      .from("label_units")
      .update({
        status: "printed",
        first_printed_at: u.first_printed_at ?? now,
        print_count: (u.print_count ?? 0) + 1,
      } as never)
      .eq("id", u.id);
  }
}
