import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { toast } from "sonner";

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

export function useSuppliers() {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["suppliers", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .eq("legal_entity_id", legalEntityId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as SupplierRow[];
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
        .select()
        .single();
      if (error) throw error;
      return data as unknown as SupplierRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Leverandør opprettet");
    },
    onError: (e: any) => toast.error(`Kunne ikke opprette: ${e.message ?? e}`),
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
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (e: any) => toast.error(`Kunne ikke lagre: ${e.message ?? e}`),
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
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { hentet: number; opprettet: number; oppdatert: number; uendret: number };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success(`${r.hentet} hentet – ${r.opprettet} nye, ${r.oppdatert} oppdatert`);
    },
    onError: (e: any) => toast.error(`Synk feilet: ${e.message ?? e}`),
  });
}
