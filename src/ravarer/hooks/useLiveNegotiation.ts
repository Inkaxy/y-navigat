import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type LiveItemStatus =
  | "pending"
  | "discussing"
  | "tentatively_agreed"
  | "agreed"
  | "declined"
  | "parked";

export interface LiveEventRow {
  id: string;
  negotiation_id: string;
  negotiation_item_id: string | null;
  event_type: string;
  event_data: any;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export function useLiveEvents(negotiationId: string | undefined) {
  return useQuery({
    queryKey: ["negotiation-live-events", negotiationId],
    enabled: !!negotiationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("negotiation_live_events" as any)
        .select("*")
        .eq("negotiation_id", negotiationId!)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as LiveEventRow[];
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
      event_data?: any;
      note?: string | null;
    }) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("negotiation_live_events" as any).insert({
        negotiation_id: input.negotiation_id,
        negotiation_item_id: input.negotiation_item_id ?? null,
        event_type: input.event_type,
        event_data: input.event_data ?? null,
        note: input.note ?? null,
        created_by: u.user?.id ?? null,
      } as any);
      if (error) throw error;
    },
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ["negotiation-live-events", v.negotiation_id] }),
  });
}

export function useUpdateLiveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      negotiation_id: string;
      patch: Record<string, any>;
    }) => {
      const { error } = await supabase
        .from("negotiation_items" as any)
        .update(input.patch as any)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["negotiation-items", v.negotiation_id] });
    },
    onError: (e: any) => toast.error(`Kunne ikke lagre: ${e.message ?? e}`),
  });
}

export function useAddLiveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      negotiation_id: string;
      raw_material_id: string;
      sort_order?: number;
    }) => {
      const { data, error } = await supabase
        .from("negotiation_items" as any)
        .insert({
          negotiation_id: input.negotiation_id,
          raw_material_id: input.raw_material_id,
          sort_order: input.sort_order ?? 0,
          live_status: "discussing",
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ["negotiation-items", v.negotiation_id] }),
    onError: (e: any) => toast.error(`Kunne ikke legge til: ${e.message ?? e}`),
  });
}

export function useDeleteLiveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; negotiation_id: string }) => {
      const { error } = await supabase
        .from("negotiation_items" as any)
        .delete()
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ["negotiation-items", v.negotiation_id] }),
  });
}
