import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/* --------------------------------------------------------------- typer */

export type PriceRoundStatus = "utkast" | "godkjent" | "publisert" | "forkastet";

export interface PriceRound {
  id: string;
  legal_entity_id: string;
  name: string;
  status: string;
  effective_date: string;
  note: string | null;
  letter_template: string | null;
  letters_generated_at: string | null;
  created_at: string;
  created_by: string | null;
  approved_at: string | null;
  published_at: string | null;
  discarded_at: string | null;
}

export interface PriceRoundLine {
  id: string;
  round_id: string;
  product_id: string;
  price_list_id: string;
  old_price: number | null;
  nodvendig_pris: number | null;
  new_price: number;
  reason: string | null;
  kostpris: number | null;
  raavarekost: number | null;
  arbeidskost: number | null;
  kvalitet: string | null;
  brutto_for: number | null;
  dg2_for: number | null;
  brutto_etter: number | null;
  dg2_etter: number | null;
  maal_brutto_pct: number | null;
  maal_dg2_pct: number | null;
  added_at: string;
  products: { navn: string | null; display_number: number | null } | null;
  price_lists: { display_name: string | null; code: string | null } | null;
}

export interface PriceRoundLetter {
  id: string;
  round_id: string;
  customer_id: string;
  customer_name: string;
  body: string;
  status: string;
  sent_at: string | null;
  sent_note: string | null;
  created_at: string;
}

export interface AddLineItem {
  product_id: string;
  price_list_id: string;
  new_price: number;
  reason?: string | null;
}

export const ROUND_STATUS_META: Record<
  string,
  { label: string; cls: string }
> = {
  utkast: { label: "Utkast", cls: "bg-muted text-muted-foreground" },
  godkjent: { label: "Godkjent", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  publisert: { label: "Publisert", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  forkastet: { label: "Forkastet", cls: "bg-destructive/15 text-destructive line-through" },
};

/** Henter en lesbar norsk feilmelding fra en Supabase-feil. */
export function rpcFeilmelding(err: unknown, fallback: string): string {
  const e = err as { message?: string; details?: string; hint?: string } | null;
  return e?.message || e?.details || fallback;
}

/* -------------------------------------------------------------- lesing */

export function usePriceRounds(legalEntityId: string | null, limit?: number) {
  return useQuery({
    queryKey: ["price-rounds", legalEntityId, limit ?? "alle"],
    enabled: !!legalEntityId,
    queryFn: async () => {
      let q = supabase
        .from("price_rounds")
        .select("*")
        .eq("legal_entity_id", legalEntityId!)
        .order("created_at", { ascending: false });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PriceRound[];
    },
  });
}

/** Antall linjer og hvilke prislister som er berørt, per runde. */
export function usePriceRoundSummaries(roundIds: string[]) {
  const key = [...roundIds].sort().join(",");
  return useQuery({
    queryKey: ["price-round-summaries", key],
    enabled: roundIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_round_lines")
        .select("round_id, price_list_id, price_lists(display_name)")
        .in("round_id", roundIds);
      if (error) throw error;
      const out: Record<string, { antall: number; lister: string[] }> = {};
      for (const r of (data ?? []) as unknown as {
        round_id: string;
        price_lists: { display_name: string | null } | null;
      }[]) {
        const e = (out[r.round_id] ??= { antall: 0, lister: [] });
        e.antall++;
        const navn = r.price_lists?.display_name;
        if (navn && !e.lister.includes(navn)) e.lister.push(navn);
      }
      return out;
    },
  });
}

export function usePriceRound(roundId: string | undefined) {
  return useQuery({
    queryKey: ["price-round", roundId],
    enabled: !!roundId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_rounds")
        .select("*")
        .eq("id", roundId!)
        .maybeSingle();
      if (error) throw error;
      return data as PriceRound | null;
    },
  });
}

export function usePriceRoundLines(roundId: string | undefined) {
  return useQuery({
    queryKey: ["price-round-lines", roundId],
    enabled: !!roundId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_round_lines")
        .select(
          "*, products(navn, display_number), price_lists(display_name, code)",
        )
        .eq("round_id", roundId!)
        .order("added_at");
      if (error) throw error;
      return (data ?? []) as unknown as PriceRoundLine[];
    },
  });
}

export function usePriceRoundLetters(roundId: string | undefined) {
  return useQuery({
    queryKey: ["price-round-letters", roundId],
    enabled: !!roundId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_round_letters")
        .select("*")
        .eq("round_id", roundId!)
        .order("customer_name");
      if (error) throw error;
      return (data ?? []) as PriceRoundLetter[];
    },
  });
}

/* ------------------------------------------------------------ skriving */

export function useCreatePriceRound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      legal_entity_id: string;
      name: string;
      effective_date: string;
      note?: string | null;
      created_by?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("price_rounds")
        .insert({
          legal_entity_id: input.legal_entity_id,
          name: input.name,
          effective_date: input.effective_date,
          note: input.note ?? null,
          created_by: input.created_by ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as PriceRound;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["price-rounds"] }),
  });
}

export function useAddPriceRoundLines() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ roundId, items }: { roundId: string; items: AddLineItem[] }) => {
      const { data, error } = await supabase.rpc("price_round_add_lines", {
        p_round_id: roundId,
        p_items: items as unknown as never,
      });
      if (error) throw error;
      return data as unknown as { ok: boolean; lines_upserted: number };
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["price-round-lines", v.roundId] });
      qc.invalidateQueries({ queryKey: ["price-round-summaries"] });
    },
  });
}

export function useSetPriceRoundStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      roundId,
      action,
    }: {
      roundId: string;
      action: "godkjenn" | "gjenapne" | "forkast";
    }) => {
      const { data, error } = await supabase.rpc("price_round_set_status", {
        p_round_id: roundId,
        p_action: action,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["price-round", v.roundId] });
      qc.invalidateQueries({ queryKey: ["price-rounds"] });
    },
  });
}

export function usePublishPriceRound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (roundId: string) => {
      const { data, error } = await supabase.rpc("price_round_publish", {
        p_round_id: roundId,
      });
      if (error) throw error;
      return data as unknown as {
        ok: boolean;
        lines_published: number;
        effective_date: string;
      };
    },
    onSuccess: (_d, roundId) => {
      qc.invalidateQueries({ queryKey: ["price-round", roundId] });
      qc.invalidateQueries({ queryKey: ["price-rounds"] });
      qc.invalidateQueries({ queryKey: ["profitability-sheet"] });
    },
  });
}

export function useGeneratePriceRoundLetters() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ roundId, template }: { roundId: string; template?: string | null }) => {
      const { data, error } = await supabase.rpc("price_round_generate_letters", {
        p_round_id: roundId,
        p_template: template ?? undefined,
      });
      if (error) throw error;
      return data as unknown as { ok: boolean; letters: number; prosentband: string };
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["price-round-letters", v.roundId] });
      qc.invalidateQueries({ queryKey: ["price-round", v.roundId] });
    },
  });
}

export function useDeletePriceRoundLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ lineId }: { lineId: string; roundId: string }) => {
      const { error } = await supabase.from("price_round_lines").delete().eq("id", lineId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["price-round-lines", v.roundId] });
    },
  });
}

export function useMarkLetterSent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ letterId }: { letterId: string; roundId: string }) => {
      const { error } = await supabase
        .from("price_round_letters")
        .update({ status: "sendt", sent_at: new Date().toISOString() })
        .eq("id", letterId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["price-round-letters", v.roundId] });
    },
  });
}
