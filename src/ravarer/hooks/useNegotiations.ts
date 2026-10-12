import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { useEffect, useRef } from "react";
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

/** Kastes når selskap/bruker/rettighet/eier endret seg midt i en flerstegs skriving. */
export class NegotiationContextChangedError extends Error {
  constructor(public readonly possiblyPartial: boolean) {
    super(possiblyPartial
      ? "Arbeidet ble stoppet fordi selskap, bruker eller tilgang endret seg. Noe kan allerede være lagret — kontroller forhandlingen."
      : "Arbeidet ble stoppet fordi selskap, bruker eller tilgang endret seg. Ingenting ble lagret.");
    this.name = "NegotiationContextChangedError";
  }
}
/** Svaret fra serveren bekrefter ikke operasjonen. Kan være lagret; prøves aldri automatisk. */
export class NegotiationUncertainReceiptError extends Error {
  constructor() {
    super("Serveren bekreftet ikke lagringen. Den kan være utført — kontroller råvarelista før du prøver igjen.");
    this.name = "NegotiationUncertainReceiptError";
  }
}

interface FrozenWriteContext { legalEntityId: string; userId: string }
/**
 * Fryser selskap + bruker ved start og kontrollerer før HVER ny skriving at eieren
 * fortsatt er montert, samme selskap/bruker er valgt og skrivetilgang finnes.
 * Databasens RLS er fortsatt autoriteten; dette stopper foreldet fortsettelse i UI.
 */
function useWriteContext() {
  const { legalEntityId, user, canWrite: moduleWrite } = useRavarer();
  // Fakturaspesifikk skriverett (samme regel som has_ravarer_invoice_access); lukket mens den lastes.
  const invoice = useInvoiceRights();
  const canWrite = moduleWrite && !invoice.loading && invoice.canWrite;
  const live = useRef({ legalEntityId, userId: user?.id ?? "", canWrite, mounted: true });
  live.current.legalEntityId = legalEntityId;
  live.current.userId = user?.id ?? "";
  live.current.canWrite = canWrite;
  useEffect(() => {
    const l = live.current;
    l.mounted = true;
    return () => { l.mounted = false; };
  }, []);
  return {
    freeze(): FrozenWriteContext {
      const l = live.current;
      if (!l.mounted || !l.legalEntityId || !l.userId || !l.canWrite) throw new NegotiationContextChangedError(false);
      return { legalEntityId: l.legalEntityId, userId: l.userId };
    },
    assert(f: FrozenWriteContext, wroteBefore: boolean) {
      const l = live.current;
      if (!l.mounted || !l.canWrite || l.legalEntityId !== f.legalEntityId || l.userId !== f.userId) {
        throw new NegotiationContextChangedError(wroteBefore);
      }
    },
  };
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
    // Selskapet er en del av nøkkelen: bufret data fra selskap A vises aldri under B.
    // Prefikset ["negotiation", id] bevares for eksisterende invalidering.
    queryKey: ["negotiation", id, legalEntityId],
    enabled: !!id && !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase.from("negotiations").select("*").eq("id", id!).eq("legal_entity_id", legalEntityId).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      // Gjeldende selskap: en forhandling fra et annet selskap vises ikke.
      if (legalEntityId && data.legal_entity_id !== legalEntityId) return null;
      return toNegotiationRow(data);
    },
  });
}

export function useNegotiationItems(negotiationId: string | undefined, opts?: { enabled?: boolean }) {
  const { legalEntityId } = useRavarer();
  return useQuery({
    // Barnedata hentes bare i gjeldende selskap og når kalleren har en matchende forelder.
    queryKey: ["negotiation-items", negotiationId, legalEntityId],
    enabled: !!negotiationId && !!legalEntityId && (opts?.enabled ?? true),
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

export function useNegotiationResponses(negotiationId: string | undefined, opts?: { enabled?: boolean }) {
  const { legalEntityId } = useRavarer();
  return useQuery({
    // Barnedata hentes bare i gjeldende selskap og når kalleren har en matchende forelder.
    queryKey: ["negotiation-responses", negotiationId, legalEntityId],
    enabled: !!negotiationId && !!legalEntityId && (opts?.enabled ?? true),
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

export function useNegotiationRecipients(negotiationId: string | undefined, opts?: { enabled?: boolean }) {
  const { legalEntityId } = useRavarer();
  return useQuery({
    // Barnedata hentes bare i gjeldende selskap og når kalleren har en matchende forelder.
    queryKey: ["negotiation-recipients", negotiationId, legalEntityId],
    enabled: !!negotiationId && !!legalEntityId && (opts?.enabled ?? true),
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
  const wc = useWriteContext();
  return useMutation({
    mutationFn: async (input: { id: string; patch: NegotiationPatch }) => {
      const f = wc.freeze();
      const { data, error } = await supabase.from("negotiations").update(input.patch)
        .eq("id", input.id).eq("legal_entity_id", f.legalEntityId).select().single();
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
  const wc = useWriteContext();
  return useMutation({
    mutationFn: async (input: { negotiationId: string; items: NegotiationItemInput[] }) => {
      const f = wc.freeze();
      // Erstatning (slett + sett inn) sletter svar/utfall/live-hendelser i kaskade.
      // Les gjeldende status og mottakere ferskt rett før, og nekt utenfor ekte utkast.
      // Serveren må håndheve samme regel (se supabase/pending/); dette er klientvernet.
      const { data: negFresh, error: negErr } = await supabase
        .from("negotiations")
        .select("status, legal_entity_id, rfq_issued_at")
        .eq("id", input.negotiationId)
        .eq("legal_entity_id", f.legalEntityId)
        .maybeSingle();
      if (negErr) throw negErr;
      if (!negFresh) throw new Error("Fant ikke forhandlingen i valgt selskap.");
      const { data: recFresh, error: recErr } = await supabase
        .from("negotiation_recipients")
        .select("invited_at, password_set_at")
        .eq("negotiation_id", input.negotiationId);
      if (recErr) throw recErr;
      if (!canReplaceNegotiationItems(negFresh.status, recFresh ?? [], negFresh.rfq_issued_at)) {
        throw new Error("Råvarelista kan ikke endres etter at lenker er generert. Eksisterende tilbud bevares.");
      }
      // Kontrakt: p_rows er en jsonb-array der hver rad tilhører p_parent_id (serveren
      // avviser ellers med 22023, og med 55000 utenfor et uutstedt utkast).
      const rows: Tables["negotiation_items"]["Insert"][] = input.items.map((it, idx) => ({
        ...it,
        negotiation_id: input.negotiationId,
        sort_order: it.sort_order ?? idx,
      }));
      wc.assert(f, false);
      const { data, error } = await supabase.rpc("replace_child_rows", {
        p_table: "negotiation_items",
        p_parent_column: "negotiation_id",
        p_parent_id: input.negotiationId,
        p_rows: rows satisfies Json,
      });
      if (error) {
        if (error.code === "55000") throw new Error("Råvarelista er låst fordi lenker er utstedt. Eksisterende tilbud bevares.");
        throw error;
      }
      // Kontrakt: antall innsatte rader. Alt annet er uklart utfall (kan være lagret).
      if (typeof data !== "number" || !Number.isInteger(data) || data !== rows.length) throw new NegotiationUncertainReceiptError();
      return data;
    },
    // Les alltid på nytt — også ved uklart utfall.
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: ["negotiation-items", v.negotiationId] }),
    onError: (e: unknown) => toast.error(`Kunne ikke lagre råvarer: ${errText(e)}`),
  });
}

export function useUpsertNegotiationRecipients() {
  const qc = useQueryClient();
  const wc = useWriteContext();
  return useMutation({
    mutationFn: async (input: {
      negotiationId: string;
      recipients: Array<{ supplier_id: string; contact_email?: string | null; contact_name?: string | null }>;
    }) => {
      // IMPORTANT: recipients hold supplier access tokens (access_token, password_*).
      // Do NOT wipe all rows and reinsert — that would destroy tokens for suppliers that
      // are kept. Instead diff by supplier_id: remove suppliers no longer in the list,
      // add new ones, and update contact info for suppliers that remain (tokens untouched).
      // Sekvensielle skrivinger uten transaksjon: konteksten kontrolleres før hver, og feil
      // etter en tidligere skriving rapporteres som mulig delvis lagring.
      const f = wc.freeze();
      let wrote = false;
      const partial = (e: unknown): Error => wrote && !(e instanceof NegotiationContextChangedError)
        ? new Error("Leverandørlista kan være delvis lagret. Kontroller lista før du fortsetter.")
        : e instanceof Error ? e : new Error("ukjent feil");
      try {
      const { data: owner, error: ownerErr } = await supabase.from("negotiations").select("id")
        .eq("id", input.negotiationId).eq("legal_entity_id", f.legalEntityId).maybeSingle();
      if (ownerErr) throw ownerErr;
      if (!owner) throw new Error("Fant ikke forhandlingen i valgt selskap.");
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
        wc.assert(f, wrote);
        const { error: rmErr } = await supabase.from("negotiation_recipients").delete().in("id", toRemove);
        if (rmErr) throw rmErr;
        wrote = true;
      }

      const toInsert = input.recipients.filter((r) => !existingBySupplier.has(r.supplier_id));
      if (toInsert.length > 0) {
        // access_token har databasedefault (genereres på serveren), men typegenereringen
        // markerer kolonnen som påkrevd. Klienten setter aldri tokenet: radene typesjekkes
        // som Insert uten access_token, og bare den ene kolonnen innsnevres mot API-typen.
        type RecipientInsert = Tables["negotiation_recipients"]["Insert"];
        type ServerTokenInsert = Omit<RecipientInsert, "access_token">;
        const typed: ServerTokenInsert[] = toInsert.map((r) => ({
          supplier_id: r.supplier_id,
          contact_email: r.contact_email ?? null,
          contact_name: r.contact_name ?? null,
          negotiation_id: input.negotiationId,
        }));
        const insertRows = typed as RecipientInsert[];
        wc.assert(f, wrote);
        const { error: insErr } = await supabase.from("negotiation_recipients").insert(insertRows);
        if (insErr) throw insErr;
        wrote = true;
      }

      for (const r of input.recipients) {
        const existingId = existingBySupplier.get(r.supplier_id);
        if (!existingId) continue;
        wc.assert(f, wrote);
        const { error: updErr } = await supabase
          .from("negotiation_recipients")
          .update({ contact_email: r.contact_email ?? null, contact_name: r.contact_name ?? null })
          .eq("id", existingId);
        if (updErr) throw updErr;
        wrote = true;
      }

      const { data, error } = await supabase
        .from("negotiation_recipients")
        .select("id, negotiation_id, supplier_id, contact_email, contact_name, status, expires_at, created_at")
        .eq("negotiation_id", input.negotiationId);
      if (error) throw error;
      return data;
      } catch (e) {
        throw partial(e);
      }
    },
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: ["negotiation-recipients", v.negotiationId] }),
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
