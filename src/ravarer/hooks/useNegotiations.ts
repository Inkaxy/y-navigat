import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { toast } from "sonner";
import { canReplaceNegotiationItems } from "@/ravarer/lib/negotiationOps";

type Tables = Database["public"]["Tables"];
type NegotiationDb = Tables["negotiations"]["Row"];
type ItemDb = Tables["negotiation_items"]["Row"];
type ResponseDb = Tables["negotiation_responses"]["Row"];

export type NegotiationStatus = Database["public"]["Enums"]["negotiation_status"];
export type NegotiationMode = "rfq" | "live";
export type LiveLocationFormat = "physical" | "video" | "phone";
export type LiveItemStatus =
  | "pending" | "discussing" | "tentatively_agreed" | "agreed" | "declined" | "parked" | "confirmed" | "unconfirmed_active";

const LIVE_ITEM_STATUSES: readonly LiveItemStatus[] = [
  "pending", "discussing", "tentatively_agreed", "agreed", "declined", "parked", "confirmed", "unconfirmed_active",
];
const LOCATION_FORMATS: readonly LiveLocationFormat[] = ["physical", "video", "phone"];

export interface NegotiationRow extends Omit<NegotiationDb, "negotiation_mode" | "live_location_format"> {
  negotiation_mode: NegotiationMode;
  live_location_format: LiveLocationFormat | null;
}

export interface NegotiationItemRow extends Omit<ItemDb, "live_status"> {
  /** Ukjent kode fra databasen blir null (vises som «Ukjent status»), aldri en gjettet status. */
  live_status: LiveItemStatus | null;
}

export type NegotiationResponseRow = ResponseDb;

export interface NegotiationRecipientRow {
  id: string;
  negotiation_id: string;
  supplier_id: string;
  contact_email: string | null;
  contact_name: string | null;
  password_set_at: string | null;
  password_expires_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
  status: Database["public"]["Enums"]["negotiation_recipient_status"];
  invited_at: string | null;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  responded_at: string | null;
  expires_at: string;
  created_at: string;
}

export function toNegotiationRow(r: NegotiationDb): NegotiationRow {
  const fmt = LOCATION_FORMATS.find((f) => f === r.live_location_format) ?? null;
  return { ...r, negotiation_mode: r.negotiation_mode === "live" ? "live" : "rfq", live_location_format: fmt };
}
export function toItemRow(r: ItemDb): NegotiationItemRow {
  return { ...r, live_status: LIVE_ITEM_STATUSES.find((s) => s === r.live_status) ?? null };
}

/** Feilmelding for brukeren uten rå backendtekst. */
function errText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "ukjent feil";
}

export function useNegotiations(opts?: { archived?: boolean }) {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["negotiations", legalEntityId, opts?.archived ?? false],
    enabled: !!legalEntityId,
    queryFn: async () => {
      let q = supabase
        .from("negotiations")
        .select("*")
        .eq("legal_entity_id", legalEntityId)
        .order("created_at", { ascending: false })
        .limit(500);
      q = opts?.archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map(toNegotiationRow);
    },
  });
}

export function useNegotiation(id: string | undefined) {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["negotiation", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("negotiations").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      // Gjeldende selskap: en forhandling fra et annet selskap vises ikke.
      if (legalEntityId && data.legal_entity_id !== legalEntityId) return null;
      return toNegotiationRow(data);
    },
  });
}

export function useNegotiationItems(negotiationId: string | undefined) {
  return useQuery({
    queryKey: ["negotiation-items", negotiationId],
    enabled: !!negotiationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("negotiation_items")
        .select("*")
        .eq("negotiation_id", negotiationId!)
        .order("sort_order")
        .limit(1000);
      if (error) throw error;
      return (data ?? []).map(toItemRow);
    },
  });
}

export function useNegotiationResponses(negotiationId: string | undefined) {
  return useQuery({
    queryKey: ["negotiation-responses", negotiationId],
    enabled: !!negotiationId,
    queryFn: async (): Promise<NegotiationResponseRow[]> => {
      const { data, error } = await supabase
        .from("negotiation_responses")
        .select("*")
        .eq("negotiation_id", negotiationId!)
        .limit(5000);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useNegotiationRecipients(negotiationId: string | undefined) {
  return useQuery({
    queryKey: ["negotiation-recipients", negotiationId],
    enabled: !!negotiationId,
    queryFn: async (): Promise<NegotiationRecipientRow[]> => {
      const { data, error } = await supabase
        .from("negotiation_recipients")
        .select("id, negotiation_id, supplier_id, contact_email, contact_name, password_set_at, password_expires_at, failed_attempts, locked_until, status, invited_at, first_viewed_at, last_viewed_at, responded_at, expires_at, created_at")
        .eq("negotiation_id", negotiationId!)
        .order("created_at")
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export type NegotiationPatch = Tables["negotiations"]["Update"];

export function useCreateNegotiation() {
  const qc = useQueryClient();
  const { legalEntityId, user } = useRavarer();
  return useMutation({
    mutationFn: async (input: Omit<Tables["negotiations"]["Insert"], "legal_entity_id" | "created_by"> & { title: string }) => {
      if (!user) throw new Error("Ikke innlogget");
      const { data, error } = await supabase
        .from("negotiations")
        .insert({ status: "draft", ...input, legal_entity_id: legalEntityId, created_by: user.id })
        .select()
        .single();
      if (error) throw error;
      return toNegotiationRow(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["negotiations"] });
    },
    onError: (e: unknown) => toast.error(`Kunne ikke opprette: ${errText(e)}`),
  });
}

export function useUpdateNegotiation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: NegotiationPatch }) => {
      const { data, error } = await supabase.from("negotiations").update(input.patch).eq("id", input.id).select().single();
      if (error) throw error;
      return toNegotiationRow(data);
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["negotiations"] });
      qc.invalidateQueries({ queryKey: ["negotiation", v.id] });
    },
    onError: (e: unknown) => toast.error(`Lagring feilet: ${errText(e)}`),
  });
}

export type NegotiationItemInput = Omit<Tables["negotiation_items"]["Insert"], "negotiation_id"> & { raw_material_id: string };

export function useUpsertNegotiationItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { negotiationId: string; items: NegotiationItemInput[] }) => {
      // Erstatning (slett + sett inn) sletter svar/utfall/live-hendelser i kaskade.
      // Les gjeldende status og mottakere ferskt rett før, og nekt utenfor ekte utkast.
      // Serveren må håndheve samme regel (se supabase/pending/); dette er klientvernet.
      const { data: negFresh, error: negErr } = await supabase
        .from("negotiations")
        .select("status")
        .eq("id", input.negotiationId)
        .maybeSingle();
      if (negErr) throw negErr;
      const { data: recFresh, error: recErr } = await supabase
        .from("negotiation_recipients")
        .select("invited_at, password_set_at")
        .eq("negotiation_id", input.negotiationId);
      if (recErr) throw recErr;
      if (!canReplaceNegotiationItems(negFresh?.status ?? null, recFresh ?? [])) {
        throw new Error("Råvarelista kan ikke endres etter at lenker er generert. Eksisterende tilbud bevares.");
      }
      const rows = input.items.map((it, idx) => ({
        ...it,
        negotiation_id: input.negotiationId,
        sort_order: it.sort_order ?? idx,
      }));
      const { data, error } = await supabase.rpc("replace_child_rows", {
        p_table: "negotiation_items",
        p_parent_column: "negotiation_id",
        p_parent_id: input.negotiationId,
        p_rows: rows as unknown as Json,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["negotiation-items", v.negotiationId] }),
    onError: (e: unknown) => toast.error(`Kunne ikke lagre råvarer: ${errText(e)}`),
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
        .from("negotiation_recipients")
        .select("id, supplier_id")
        .eq("negotiation_id", input.negotiationId);
      if (existErr) throw existErr;
      const existingRows = existing ?? [];
      const existingBySupplier = new Map(existingRows.map((r) => [r.supplier_id, r.id]));
      const nextSupplierIds = new Set(input.recipients.map((r) => r.supplier_id));

      const toRemove = existingRows.filter((r) => !nextSupplierIds.has(r.supplier_id)).map((r) => r.id);
      if (toRemove.length > 0) {
        const { error: rmErr } = await supabase.from("negotiation_recipients").delete().in("id", toRemove);
        if (rmErr) throw rmErr;
      }

      const toInsert = input.recipients.filter((r) => !existingBySupplier.has(r.supplier_id));
      if (toInsert.length > 0) {
        const { error: insErr } = await supabase
          .from("negotiation_recipients")
          .insert(toInsert.map((r) => ({ ...r, negotiation_id: input.negotiationId })));
        if (insErr) throw insErr;
      }

      for (const r of input.recipients) {
        const existingId = existingBySupplier.get(r.supplier_id);
        if (!existingId) continue;
        const { error: updErr } = await supabase
          .from("negotiation_recipients")
          .update({ contact_email: r.contact_email ?? null, contact_name: r.contact_name ?? null })
          .eq("id", existingId);
        if (updErr) throw updErr;
      }

      const { data, error } = await supabase
        .from("negotiation_recipients")
        .select("id, negotiation_id, supplier_id, contact_email, contact_name, status, expires_at, created_at")
        .eq("negotiation_id", input.negotiationId);
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["negotiation-recipients", v.negotiationId] }),
    onError: (e: unknown) => toast.error(`Kunne ikke lagre leverandører: ${errText(e)}`),
  });
}

/**
 * Genererer lenker og passord. Svaret returneres rått (`unknown`) og MÅ leses av
 * `parseRfqCredentials` mot frosset mottakersett — rekkefølge eller form er ikke garantert.
 */
export function useGenerateRfqCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { negotiationId: string }): Promise<unknown> => {
      const { data, error } = await supabase.functions.invoke("generate-rfq-credentials", {
        body: { negotiation_id: input.negotiationId },
      });
      if (error) throw error;
      return data;
    },
    onSettled: (_d, _e, v) => {
      // Status/mottakere leses alltid på nytt — også ved feil, fordi passord kan være rotert.
      qc.invalidateQueries({ queryKey: ["negotiations"] });
      qc.invalidateQueries({ queryKey: ["negotiation", v.negotiationId] });
      qc.invalidateQueries({ queryKey: ["negotiation-recipients", v.negotiationId] });
    },
    onError: () => toast.error("Lenkene ble ikke bekreftet generert. Passord kan være endret — generer nye lenker bevisst ved behov."),
  });
}
