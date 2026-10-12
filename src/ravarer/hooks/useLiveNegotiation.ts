import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { toItemRow } from "@/ravarer/hooks/useNegotiations";

export type { LiveItemStatus } from "@/ravarer/hooks/useNegotiations";
export type LiveEventRow = Database["public"]["Tables"]["negotiation_live_events"]["Row"];
export type LiveItemPatch = Database["public"]["Tables"]["negotiation_items"]["Update"];

function errText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "ukjent feil";
}

export function useLiveEvents(negotiationId: string | undefined) {
  return useQuery({
    queryKey: ["negotiation-live-events", negotiationId],
    enabled: !!negotiationId,
    queryFn: async (): Promise<LiveEventRow[]> => {
      const { data, error } = await supabase
        .from("negotiation_live_events")
        .select("*")
        .eq("negotiation_id", negotiationId!)
        .order("created_at")
        .limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useLogLiveEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      negotiation_id: string;
      negotiation_item_id?: string | null;
      event_type: string;
      event_data?: Json | null;
      note?: string | null;
    }) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("negotiation_live_events").insert({
        negotiation_id: input.negotiation_id,
        negotiation_item_id: input.negotiation_item_id ?? null,
        event_type: input.event_type,
        event_data: input.event_data ?? null,
        note: input.note ?? null,
        created_by: u.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["negotiation-live-events", v.negotiation_id] }),
  });
}

export function useUpdateLiveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; negotiation_id: string; patch: LiveItemPatch }) => {
      const { error } = await supabase.from("negotiation_items").update(input.patch).eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["negotiation-items", v.negotiation_id] });
    },
    onError: (e: unknown) => toast.error(`Kunne ikke lagre: ${errText(e)}`),
  });
}

export function useAddLiveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { negotiation_id: string; raw_material_id: string; sort_order?: number }) => {
      const { data, error } = await supabase
        .from("negotiation_items")
        .insert({
          negotiation_id: input.negotiation_id,
          raw_material_id: input.raw_material_id,
          sort_order: input.sort_order ?? 0,
          live_status: "discussing",
        })
        .select()
        .single();
      if (error) throw error;
      return toItemRow(data);
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["negotiation-items", v.negotiation_id] }),
    onError: (e: unknown) => toast.error(`Kunne ikke legge til: ${errText(e)}`),
  });
}

export function useDeleteLiveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; negotiation_id: string }) => {
      const { error } = await supabase.from("negotiation_items").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["negotiation-items", v.negotiation_id] }),
  });
}
