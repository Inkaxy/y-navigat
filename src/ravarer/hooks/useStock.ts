import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { fetchAllRows } from "@/lib/supabasePaging";
import { toast } from "sonner";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import type { MovementType } from "@/ravarer/lib/stock";
import { osloDateISOPlusDays } from "@/lib/osloDate";

export interface StockMovementRow {
  id: string;
  raw_material_id: string | null;
  movement_type: string;
  quantity_base: number;
  occurred_at: string;
  source_table: string | null;
  source_id: string | null;
  product_id: string | null;
  note: string | null;
}

/** Bevegelseshistorikk for én råvare, nyeste først. */
export function useStockMovements(rawMaterialId: string | undefined) {
  return useQuery({
    queryKey: ["stock-movements", rawMaterialId],
    enabled: !!rawMaterialId,
    queryFn: async () => {
      // Hele historikken hentes — en .limit() her skjulte eldre bevegelser
      // og gjorde reskontroen misvisende.
      const rows = await fetchAllRows<StockMovementRow>((from, to) =>
        supabase
          .from("stock_movements")
          .select("id, raw_material_id, movement_type, quantity_base, occurred_at, source_table, source_id, product_id, note")
          .eq("raw_material_id", rawMaterialId!)
          .order("occurred_at", { ascending: false })
          .range(from, to),
      );

      // Slå opp faktura-id for linje-baserte innkjøp så vi kan lenke til fakturaen.
      const lineIds = rows
        .filter(r => r.source_table === "invoice_lines" && r.source_id)
        .map(r => r.source_id!) as string[];
      const invoiceIdByLineId = new Map<string, string>();
      if (lineIds.length > 0) {
        const { data: lines } = await supabase
          .from("invoice_lines")
          .select("id, invoice_id")
          .in("id", Array.from(new Set(lineIds)));
        (lines ?? []).forEach(l => invoiceIdByLineId.set(l.id, l.invoice_id));
      }

      // Samme for oppskriftsuttrekk fra pakkseddellinjer.
      const dnLineIds = rows
        .filter(r => r.source_table === "delivery_note_lines" && r.source_id)
        .map(r => r.source_id!) as string[];
      const deliveryNoteIdByLineId = new Map<string, string>();
      if (dnLineIds.length > 0) {
        const { data: dnLines } = await supabase
          .from("delivery_note_lines")
          .select("id, delivery_note_id")
          .in("id", Array.from(new Set(dnLineIds)));
        (dnLines ?? []).forEach(l => deliveryNoteIdByLineId.set(l.id, l.delivery_note_id));
      }
      return { rows, invoiceIdByLineId, deliveryNoteIdByLineId };
    },
  });
}

/** Har råvaren noen bevegelser i det hele tatt? (brukes til førstegangsoppsett) */
export function useHasMovements(rawMaterialId: string | undefined) {
  return useQuery({
    queryKey: ["stock-has-movements", rawMaterialId],
    enabled: !!rawMaterialId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("stock_movements")
        .select("id", { count: "exact", head: true })
        .eq("raw_material_id", rawMaterialId!);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });
}

interface CreateMovementInput {
  raw_material_id: string;
  movement_type: MovementType;
  quantity_base: number;
  note: string;
  occurred_at?: string;
}

/** Setter inn én bevegelse. Skriver ALDRI til current_stock — det gjør databasen. */
export function useCreateStockMovement() {
  const qc = useQueryClient();
  const { legalEntityId, user } = useRavarer();
  return useMutation({
    mutationFn: async (input: CreateMovementInput) => {
      const { data, error } = await supabase
        .from("stock_movements")
        .insert({
          legal_entity_id: legalEntityId,
          raw_material_id: input.raw_material_id,
          movement_type: input.movement_type,
          quantity_base: input.quantity_base,
          note: input.note,
          occurred_at: input.occurred_at ?? new Date().toISOString(),
          source_table: "manual",
          created_by: user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      invalidateRawMaterial(qc, vars.raw_material_id);
      toast.success("Bevegelse registrert");
    },
    onError: (e: unknown) => toast.error(`Kunne ikke registrere: ${e instanceof Error ? e.message : String(e)}`),
  });
}

export interface RawMaterialProductLink {
  id: string;
  raw_material_id: string;
  product_id: string;
  base_units_per_sold_unit: number;
  is_primary: boolean;
  note: string | null;
  product: { id: string; code: string; display_name: string; display_number: number } | null;
}

export function useRawMaterialProducts(rawMaterialId: string | undefined) {
  return useQuery({
    queryKey: ["raw-material-products", rawMaterialId],
    enabled: !!rawMaterialId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_products")
        .select("id, raw_material_id, product_id, base_units_per_sold_unit, is_primary, note, product:products(id, code, display_name, display_number)")
        .eq("raw_material_id", rawMaterialId!);
      if (error) throw error;
      return (data ?? []) as unknown as RawMaterialProductLink[];
    },
  });
}

/** Koblinger vist fra varekortet: hvilke handelsvarer trekkes fra ved salg. */
export function useProductStockLinks(productId: string | undefined) {
  return useQuery({
    queryKey: ["product-stock-links", productId],
    enabled: !!productId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_products")
        .select("id, base_units_per_sold_unit, raw_material:raw_materials(id, name, base_unit, stock_tracking, current_stock)")
        .eq("product_id", productId!);
      if (error) throw error;
      return (data ?? []) as unknown as {
        id: string;
        base_units_per_sold_unit: number;
        raw_material: { id: string; name: string; base_unit: string; stock_tracking: boolean; current_stock: number } | null;
      }[];
    },
  });
}

export function useProductSearch(term: string) {
  const { legalEntityId } = useRavarer();
  const q = term.trim();
  return useQuery({
    queryKey: ["stock-product-search", legalEntityId, q],
    enabled: !!legalEntityId && q.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, code, display_name, display_number")
        .eq("legal_entity_id", legalEntityId)
        .or(`display_name.ilike.%${q}%,code.ilike.%${q}%`)
        .order("display_name")
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useLinkProduct() {
  const qc = useQueryClient();
  const { user } = useRavarer();
  return useMutation({
    mutationFn: async (input: { raw_material_id: string; product_id: string; base_units_per_sold_unit?: number }) => {
      const { error } = await supabase.from("raw_material_products").insert({
        raw_material_id: input.raw_material_id,
        product_id: input.product_id,
        base_units_per_sold_unit: input.base_units_per_sold_unit ?? 1,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidateRawMaterial(qc, vars.raw_material_id);
      toast.success("Vare koblet");
    },
    onError: (e: unknown) => toast.error(`Kunne ikke koble: ${e instanceof Error ? e.message : String(e)}`),
  });
}

export function useUpdateProductLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; raw_material_id: string; base_units_per_sold_unit?: number; note?: string | null; is_primary?: boolean }) => {
      const { id, raw_material_id, ...patch } = input;
      const { error } = await supabase.from("raw_material_products").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["raw-material-products", vars.raw_material_id] });
      toast.success("Lagret");
    },
    onError: (e: unknown) => toast.error(`Kunne ikke lagre: ${e instanceof Error ? e.message : String(e)}`),
  });
}

export function useDeleteProductLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; raw_material_id: string }) => {
      const { error } = await supabase.from("raw_material_products").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidateRawMaterial(qc, vars.raw_material_id);
      toast.success("Kobling fjernet");
    },
    onError: (e: unknown) => toast.error(`Kunne ikke fjerne: ${e instanceof Error ? e.message : String(e)}`),
  });
}

export interface MissingBaseQuantityLine {
  id: string;
  invoice_id: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  raw_material_id: string;
  raw_material_name: string;
  invoice_number: string;
  invoice_date: string;
}

/**
 * Fakturalinjer siste 90 dager som er matchet mot en handelsvare med lagerføring,
 * men som ikke ga noen bevegelse fordi base_quantity mangler.
 */
export function useMissingBaseQuantityLines() {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["stock-missing-base-quantity", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<MissingBaseQuantityLine[]> => {
      const { data: rms, error: rmErr } = await supabase
        .from("raw_materials")
        .select("id, name")
        .eq("legal_entity_id", legalEntityId)
        .eq("is_resale_item", true)
        .eq("stock_tracking", true);
      if (rmErr) throw rmErr;
      const nameById = new Map((rms ?? []).map(r => [r.id, r.name]));
      const ids = Array.from(nameById.keys());
      if (ids.length === 0) return [];

      const since = osloDateISOPlusDays(-90);
      const { data, error } = await supabase
        .from("invoice_lines")
        .select("id, invoice_id, description, quantity, unit, raw_material_id, invoice:invoices!inner(id, invoice_number, invoice_date, legal_entity_id)")
        .in("raw_material_id", ids)
        .is("base_quantity", null)
        .gte("invoice.invoice_date", since)
        .eq("invoice.legal_entity_id", legalEntityId)
        .order("id")
        .limit(200);
      if (error) throw error;

      type LineRow = {
        id: string;
        invoice_id: string;
        description: string | null;
        quantity: number | null;
        unit: string | null;
        raw_material_id: string;
        invoice: { invoice_number: string; invoice_date: string } | null;
      };
      return ((data ?? []) as unknown as LineRow[]).map(l => ({
        id: l.id,
        invoice_id: l.invoice_id,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        raw_material_id: l.raw_material_id,
        raw_material_name: nameById.get(l.raw_material_id) ?? "—",
        invoice_number: l.invoice?.invoice_number ?? "—",
        invoice_date: l.invoice?.invoice_date ?? "",
      }));
    },
  });
}
