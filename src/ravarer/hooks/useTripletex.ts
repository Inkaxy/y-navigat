import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TripletexCredentialRow {
  legal_entity_id: string;
  mode: "jwt" | "standard" | "private";
  has_consumer_token: boolean;
  has_employee_token: boolean;
  sync_enabled: boolean;
  sync_frequency_minutes: number;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  last_supplier_sync_at: string | null;
  last_invoice_synced_date: string | null;
  initial_import_done: boolean | null;
}

export function useTripletexCredentials(legalEntityId: string | null | undefined) {
  return useQuery({
    queryKey: ["tripletex-credentials", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<TripletexCredentialRow | null> => {
      const { data, error } = await supabase
        .from("tripletex_credentials")
        .select(
          "legal_entity_id, mode, sync_enabled, sync_frequency_minutes, last_synced_at, last_sync_status, last_sync_error, last_supplier_sync_at, last_invoice_synced_date, initial_import_done",
        )
        .eq("legal_entity_id", legalEntityId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      // Token-flagg hentes via SECURITY DEFINER funksjon — selve token-feltene
      // er REVOKED for authenticated for å hindre eksponering.
      const { data: tokenStatus } = await (supabase.rpc as any)("tripletex_token_status", {
        _legal_entity_id: legalEntityId,
      });
      const status = Array.isArray(tokenStatus) ? tokenStatus[0] : tokenStatus;
      return {
        legal_entity_id: data.legal_entity_id,
        mode: (data.mode as "jwt" | "standard" | "private") ?? "standard",
        has_consumer_token: !!status?.has_consumer_token,
        has_employee_token: !!status?.has_employee_token,
        sync_enabled: data.sync_enabled,
        sync_frequency_minutes: data.sync_frequency_minutes,
        last_synced_at: data.last_synced_at,
        last_sync_status: data.last_sync_status,
        last_sync_error: data.last_sync_error,
        last_supplier_sync_at: data.last_supplier_sync_at,
        last_invoice_synced_date: data.last_invoice_synced_date,
        initial_import_done: data.initial_import_done,
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
