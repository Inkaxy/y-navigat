import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TripletexCredentialRow {
  legal_entity_id: string;
  mode: "standard" | "private";
  has_consumer_token: boolean;
  has_employee_token: boolean;
  sync_enabled: boolean;
  sync_frequency_minutes: number;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
}

export function useTripletexCredentials(legalEntityId: string | null | undefined) {
  return useQuery({
    queryKey: ["tripletex-credentials", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<TripletexCredentialRow | null> => {
      const { data, error } = await supabase
        .from("tripletex_credentials")
        .select(
          "legal_entity_id, mode, consumer_token_encrypted, employee_token_encrypted, sync_enabled, sync_frequency_minutes, last_synced_at, last_sync_status, last_sync_error",
        )
        .eq("legal_entity_id", legalEntityId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        legal_entity_id: data.legal_entity_id,
        mode: (data.mode as "standard" | "private") ?? "standard",
        has_consumer_token: !!data.consumer_token_encrypted,
        has_employee_token: !!data.employee_token_encrypted,
        sync_enabled: data.sync_enabled,
        sync_frequency_minutes: data.sync_frequency_minutes,
        last_synced_at: data.last_synced_at,
        last_sync_status: data.last_sync_status,
        last_sync_error: data.last_sync_error,
      };
    },
  });
}

export function useTripletexSyncLog(legalEntityId: string | null | undefined) {
  return useQuery({
    queryKey: ["tripletex-sync-log", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tripletex_sync_log")
        .select("*")
        .eq("legal_entity_id", legalEntityId!)
        .order("started_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
}
