import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";

export type PakkesystemKey = {
  id: string;
  legal_entity_id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type PakkesystemLogRow = {
  id: string;
  api_key_id: string | null;
  endpoint: string;
  status_code: number;
  row_count: number | null;
  ip: string | null;
  query_params: Record<string, string> | null;
  created_at: string;
};

async function sha256Hex(input: string) {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `psk_${b64}`;
}

export function usePakkesystemKeys() {
  return useQuery({
    queryKey: ["pakkesystem-keys"],
    queryFn: async (): Promise<PakkesystemKey[]> => {
      const { data, error } = await supabase
        .from("pakkesystem_api_keys")
        .select("id, legal_entity_id, name, key_prefix, created_at, last_used_at, revoked_at")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PakkesystemKey[];
    },
  });
}

export function useCreatePakkesystemKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<{ plaintext: string; row: PakkesystemKey }> => {
      const token = generateToken();
      const hash = await sha256Hex(token);
      const prefix = token.slice(0, 12);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("pakkesystem_api_keys")
        .insert({
          legal_entity_id: NB_LEGAL_ENTITY_ID,
          name,
          key_hash: hash,
          key_prefix: prefix,
          created_by: user?.id ?? null,
        })
        .select("id, legal_entity_id, name, key_prefix, created_at, last_used_at, revoked_at")
        .single();
      if (error) throw error;
      return { plaintext: token, row: data as PakkesystemKey };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pakkesystem-keys"] }),
  });
}

export function useRevokePakkesystemKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pakkesystem_api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pakkesystem-keys"] }),
  });
}

export function usePakkesystemLog() {
  return useQuery({
    queryKey: ["pakkesystem-log"],
    queryFn: async (): Promise<PakkesystemLogRow[]> => {
      const { data, error } = await supabase
        .from("pakkesystem_api_log")
        .select("id, api_key_id, endpoint, status_code, row_count, ip, query_params, created_at")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as PakkesystemLogRow[];
    },
    refetchInterval: 15_000,
  });
}
