import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { toast } from "sonner";
import { showError } from "@/lib/userError";
import { invalidateRavarerCounts } from "@/ravarer/lib/invalidate";

export interface SupplierRow {
  id: string;
  legal_entity_id: string;
  name: string;
  org_number: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
  notes: string | null;
  track_invoice_lines: boolean;
  tripletex_is_inactive: boolean | null;
  tripletex_supplier_number: string | null;
  tripletex_synced_at: string | null;
  last_invoice_date: string | null;
  invoice_count: number | null;
}

const SUPPLIER_COLUMNS = "id, legal_entity_id, name, org_number, contact_email, contact_phone, is_active, notes, track_invoice_lines, tripletex_is_inactive, tripletex_supplier_number, tripletex_synced_at, last_invoice_date, invoice_count";

/** Edge-svar kan bære en feilmelding i kroppen selv når kallet lykkes. */
function edgeBodyError(data: unknown): string | null {
  if (data && typeof data === "object" && "error" in data) {
    const e = (data as { error: unknown }).error;
    if (typeof e === "string" && e) return e;
  }
  return null;
}

export function useSuppliers() {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["suppliers", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select(SUPPLIER_COLUMNS)
        .eq("legal_entity_id", legalEntityId)
        .order("name");
      if (error) throw error;
      const rows: SupplierRow[] = data ?? [];
      return rows;
    },
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  const { legalEntityId } = useRavarer();
  return useMutation({
    mutationFn: async (input: { name: string; org_number?: string; contact_email?: string; contact_phone?: string }) => {
      const { data, error } = await supabase
        .from("suppliers")
        .insert({ ...input, legal_entity_id: legalEntityId })
        .select(SUPPLIER_COLUMNS)
        .single();
      if (error) throw error;
      const row: SupplierRow = data;
      return row;
    },
    onSuccess: () => {
      invalidateRavarerCounts(qc);
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Leverandør opprettet");
    },
    onError: (e: unknown) => showError("leverandor:opprett", e, "Kunne ikke opprette leverandøren."),
  });
}

/** Slår «følg fakturalinjer» av/på for en leverandør. */
export function useSetTrackInvoiceLines() {
  const qc = useQueryClient();
  const { user } = useRavarer();
  return useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await supabase
        .from("suppliers")
        .update({
          track_invoice_lines: value,
          line_tracking_changed_at: new Date().toISOString(),
          line_tracking_changed_by: user?.id ?? null,
        })
        .eq("id", id);
      if (error) throw error;
      return value;
    },
    onSuccess: () => {
      invalidateRavarerCounts(qc);
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (e: unknown) => showError("leverandor:sporing", e, "Kunne ikke lagre."),
  });
}

/** Etterhenter fakturaer for én leverandør (brukes når sporing skrus på). */
export function useBackfillSupplierInvoices() {
  const qc = useQueryClient();
  const { legalEntityId } = useRavarer();
  return useMutation({
    mutationFn: async ({ supplierId, months = 12 }: { supplierId: string; months?: number }) => {
      const { data, error } = await supabase.functions.invoke("tripletex-sync-invoices", {
        body: { legal_entity_id: legalEntityId, supplier_id: supplierId, backfill_months: months },
      });
      if (error) throw error;
      const bodyError = edgeBodyError(data);
      if (bodyError) throw new Error(bodyError);
      return data as { imported?: number; skipped?: number; fetched?: number; reason?: string };
    },
    onSuccess: (r) => {
      invalidateRavarerCounts(qc);
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["fakturaer"] });
      if (r?.reason) toast.info(r.reason);
      else toast.success(`Hentet ${r?.imported ?? 0} nye fakturaer (${r?.fetched ?? 0} funnet)`);
    },
    onError: (e: unknown) => showError("leverandor:etterhent", e, "Etterhenting feilet. Prøv igjen."),
  });
}

/** Speiler leverandører fra Tripletex til suppliers-tabellen. */
export function useSyncSuppliersFromTripletex() {
  const qc = useQueryClient();
  const { legalEntityId } = useRavarer();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("tripletex-sync-suppliers", {
        body: { legal_entity_id: legalEntityId },
      });
      if (error) throw error;
      const bodyError = edgeBodyError(data);
      if (bodyError) throw new Error(bodyError);
      return data as {
        hentet: number;
        opprettet: number;
        oppdatert: number;
        uendret: number;
        hoppet?: number;
        hoppet_navn?: { navn: string; grunn: string }[];
      };
    },
    onSuccess: (r) => {
      invalidateRavarerCounts(qc);
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      const skipped = r.hoppet ?? 0;
      toast.success(
        `${r.hentet} hentet – ${r.opprettet} nye, ${r.oppdatert} oppdatert${skipped ? `, ${skipped} hoppet over` : ""}`,
      );
      if (skipped && r.hoppet_navn?.length) {
        toast.info(`Hoppet over: ${r.hoppet_navn.map((h) => h.navn).join(", ")}`);
      }
    },
    onError: (e: unknown) => showError("leverandor:synk", e, "Synk med Tripletex feilet. Prøv igjen."),
  });
}
