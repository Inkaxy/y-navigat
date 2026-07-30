import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { toast } from "sonner";

export type NegotiationStatus = "draft" | "invited" | "in_progress" | "awaiting_confirmation" | "concluded" | "cancelled";

export interface NegotiationRow {
  id: string;
  legal_entity_id: string;
  title: string;
  purpose: string | null;
  contract_start: string | null;
  contract_end: string | null;
  baseline_period_start: string | null;
  baseline_period_end: string | null;
  response_deadline: string | null;
  status: NegotiationStatus;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  concluded_at: string | null;
  archived_at: string | null;
  negotiation_mode?: "rfq" | "live";
  live_session_started_at?: string | null;
  live_session_ended_at?: string | null;
  live_facilitator_id?: string | null;
  live_location_format?: "physical" | "video" | "phone" | null;
  live_session_paused?: boolean | null;
  live_confirmation_deadline?: string | null;
  live_auto_apply_on_confirm?: boolean | null;
}

export interface NegotiationItemRow {
  id: string;
  negotiation_id: string;
  raw_material_id: string;
  expected_annual_volume: number | null;
  expected_annual_volume_unit: string | null;
  actual_volume_baseline: number | null;
  actual_cost_baseline: number | null;
  actual_avg_price_baseline: number | null;
  target_price: number | null;
  suggested_package_size: number | null;
  suggested_package_unit: string | null;
  notes: string | null;
  sort_order: number;
  live_status?: "pending" | "discussing" | "tentatively_agreed" | "agreed" | "declined" | "parked" | "confirmed" | "unconfirmed_active";
  live_agreed_price?: number | null;
  live_agreed_price_unit?: string | null;
  live_agreed_package_size?: number | null;
  live_agreed_package_unit?: string | null;
  live_agreed_price_per_base_unit?: number | null;
  live_agreed_contract_months?: number | null;
  live_agreed_min_volume?: number | null;
  live_agreed_min_volume_unit?: string | null;
  live_agreed_payment_terms_days?: number | null;
  live_agreed_at?: string | null;
  live_agreed_by?: string | null;
  live_notes?: string | null;
  live_confirmed_at?: string | null;
  live_confirmed_by_supplier?: boolean | null;
  live_supplier_note?: string | null;
  live_datasheet_path?: string | null;
  live_datasheet_skipped?: boolean | null;
}

export interface NegotiationRecipientRow {
  id: string;
  negotiation_id: string;
  supplier_id: string;
  contact_email: string | null;
  contact_name: string | null;
  access_token?: string;
  password_set_at: string | null;
  password_expires_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
  status: "invited" | "viewed" | "responded" | "declined" | "expired" | "locked";
  invited_at: string | null;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  responded_at: string | null;
  expires_at: string;
}

export function useNegotiations(opts?: { archived?: boolean }) {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["negotiations", legalEntityId, opts?.archived ?? false],
    queryFn: async () => {
      let q = supabase
        .from("negotiations" as any)
        .select("*")
        .eq("legal_entity_id", legalEntityId)
        .order("created_at", { ascending: false });
      if (opts?.archived) q = q.not("archived_at", "is", null);
      else q = q.is("archived_at", null);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as NegotiationRow[];
    },
  });
}

export function useNegotiation(id: string | undefined) {
  return useQuery({
    queryKey: ["negotiation", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("negotiations" as any)
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as NegotiationRow | null;
    },
  });
}

export function useNegotiationItems(negotiationId: string | undefined) {
  return useQuery({
    queryKey: ["negotiation-items", negotiationId],
    enabled: !!negotiationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("negotiation_items" as any)
        .select("*")
        .eq("negotiation_id", negotiationId!)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as unknown as NegotiationItemRow[];
    },
  });
}

export function useNegotiationRecipients(negotiationId: string | undefined) {
  return useQuery({
    queryKey: ["negotiation-recipients", negotiationId],
    enabled: !!negotiationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("negotiation_recipients" as any)
        .select("id, negotiation_id, supplier_id, contact_email, contact_name, password_set_at, password_expires_at, failed_attempts, locked_until, status, invited_at, first_viewed_at, last_viewed_at, responded_at, expires_at, created_at")
        .eq("negotiation_id", negotiationId!)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as NegotiationRecipientRow[];
    },
  });
}

export function useCreateNegotiation() {
  const qc = useQueryClient();
  const { legalEntityId, user } = useRavarer();
  return useMutation({
    mutationFn: async (input: Partial<NegotiationRow> & { title: string }) => {
      const { data, error } = await supabase
        .from("negotiations" as any)
        .insert({
          legal_entity_id: legalEntityId,
          created_by: user!.id,
          status: "draft",
          ...input,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as NegotiationRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["negotiations"] });
    },
    onError: (e: any) => toast.error(`Kunne ikke opprette: ${e.message ?? e}`),
  });
}

export function useUpdateNegotiation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<NegotiationRow> }) => {
      const { data, error } = await supabase
        .from("negotiations" as any)
        .update(input.patch as any)
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as NegotiationRow;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["negotiations"] });
      qc.invalidateQueries({ queryKey: ["negotiation", v.id] });
    },
    onError: (e: any) => toast.error(`Lagring feilet: ${e.message ?? e}`),
  });
}

export function useUpsertNegotiationItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      negotiationId: string;
      items: Array<Partial<NegotiationItemRow> & { raw_material_id: string }>;
    }) => {
      // Replace all items for this negotiation atomically (delete + insert in one transaction)
      const rows = input.items.map((it, idx) => ({
        ...it,
        negotiation_id: input.negotiationId,
        sort_order: it.sort_order ?? idx,
      }));
      const { data, error } = await (supabase as any).rpc("replace_child_rows", {
        p_table: "negotiation_items",
        p_parent_column: "negotiation_id",
        p_parent_id: input.negotiationId,
        p_rows: rows,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ["negotiation-items", v.negotiationId] }),
    onError: (e: any) => toast.error(`Kunne ikke lagre råvarer: ${e.message ?? e}`),
  });
}

export function useUpsertNegotiationRecipients() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      negotiationId: string;
      recipients: Array<{ supplier_id: string; contact_email?: string | null; contact_name?: string | null }>;
    }) => {
      // IMPORTANT: recipients hold supplier access tokens (access_token, password_*).
      // Do NOT wipe all rows and reinsert — that would destroy tokens for suppliers that
      // are kept. Instead diff by supplier_id: remove suppliers no longer in the list,
      // add new ones, and update contact info for suppliers that remain (tokens untouched).
      const { data: existing, error: existErr } = await supabase
        .from("negotiation_recipients" as any)
        .select("id, supplier_id")
        .eq("negotiation_id", input.negotiationId);
      if (existErr) throw existErr;
      const existingRows = (existing ?? []) as unknown as Array<{ id: string; supplier_id: string }>;
      const existingBySupplier = new Map(existingRows.map((r) => [r.supplier_id, r.id]));
      const nextSupplierIds = new Set(input.recipients.map((r) => r.supplier_id));

      const toRemove = existingRows.filter((r) => !nextSupplierIds.has(r.supplier_id)).map((r) => r.id);
      if (toRemove.length > 0) {
        const { error: rmErr } = await supabase
          .from("negotiation_recipients" as any)
          .delete()
          .in("id", toRemove);
        if (rmErr) throw rmErr;
      }

      const toInsert = input.recipients.filter((r) => !existingBySupplier.has(r.supplier_id));
      if (toInsert.length > 0) {
        const insertRows = toInsert.map((r) => ({
          ...r,
          negotiation_id: input.negotiationId,
        }));
        const { error: insErr } = await supabase.from("negotiation_recipients" as any).insert(insertRows as any);
        if (insErr) throw insErr;
      }

      for (const r of input.recipients) {
        const existingId = existingBySupplier.get(r.supplier_id);
        if (!existingId) continue;
        const { error: updErr } = await supabase
          .from("negotiation_recipients" as any)
          .update({ contact_email: r.contact_email ?? null, contact_name: r.contact_name ?? null })
          .eq("id", existingId);
        if (updErr) throw updErr;
      }

      const { data, error } = await supabase
        .from("negotiation_recipients" as any)
        .select("id, negotiation_id, supplier_id, contact_email, contact_name, status, expires_at, created_at")
        .eq("negotiation_id", input.negotiationId);
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ["negotiation-recipients", v.negotiationId] }),
    onError: (e: any) => toast.error(`Kunne ikke lagre leverandører: ${e.message ?? e}`),
  });
}

export function useGenerateRfqCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { negotiationId: string }) => {
      const { data, error } = await supabase.functions.invoke("generate-rfq-credentials", {
        body: { negotiation_id: input.negotiationId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? "Ukjent feil");
      return data as {
        success: true;
        credentials: Array<{
          recipient_id: string;
          supplier_id: string;
          supplier_name: string;
          contact_email: string | null;
          access_token: string;
          password: string;
          portal_url: string;
        }>;
      };
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["negotiations"] });
      qc.invalidateQueries({ queryKey: ["negotiation", v.negotiationId] });
      qc.invalidateQueries({ queryKey: ["negotiation-recipients", v.negotiationId] });
    },
    onError: (e: any) => toast.error(`Kunne ikke generere passord: ${e.message ?? e}`),
  });
}
