import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface DeclarationWorklistRow {
  raw_material_id: string;
  legal_entity_id: string | null;
  name: string;
  is_composite: boolean;
  suggested_name: string | null;
  matvaretabellen_name: string | null;
  recipes_using: number;
  total_quantity: number | null;
}

/** Forslag til lovlig ingrediensnavn fra innkjøpsnavnet (SQL-funksjon). */
export async function suggestDeclarationName(name: string): Promise<string> {
  const { data, error } = await supabase.rpc("declaration_name_suggest", { p_name: name });
  if (error) throw error;
  return (data as string | null) ?? "";
}

/** Arbeidsliste: aktive råvarer i bruk som mangler deklarasjonsnavn. */
export function useDeclarationWorklist(legalEntityId: string | undefined) {
  return useQuery({
    queryKey: ["declaration-worklist", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_declaration_worklist")
        .select("*")
        .eq("legal_entity_id", legalEntityId!)
        .order("total_quantity", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        raw_material_id: r.raw_material_id as string,
        legal_entity_id: r.legal_entity_id,
        name: r.name ?? "",
        is_composite: !!r.is_composite,
        suggested_name: r.suggested_name,
        matvaretabellen_name: r.matvaretabellen_name,
        recipes_using: Number(r.recipes_using ?? 0),
        total_quantity: r.total_quantity != null ? Number(r.total_quantity) : null,
      })) as DeclarationWorklistRow[];
    },
  });
}

/** Lagrer raw_materials.declaration_name. */
export function useSaveDeclarationName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { rawMaterialId: string; declarationName: string; silent?: boolean }) => {
      const value = input.declarationName.trim().toLowerCase();
      if (!value) throw new Error("Deklarasjonsnavnet kan ikke være tomt");
      const { error } = await supabase
        .from("raw_materials")
        .update({ declaration_name: value })
        .eq("id", input.rawMaterialId);
      if (error) throw error;
      return { ...input, value };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["declaration-worklist"] });
      qc.invalidateQueries({ queryKey: ["raw_materials"] });
      qc.invalidateQueries({ queryKey: ["raw_material", res.rawMaterialId] });
      // `silent` brukes av «Lagre alle utfylte», som gir én oppsummering til slutt.
      if (!res.silent) toast.success(`Deklarasjonsnavn lagret: «${res.value}»`);
    },
    onError: (e: any) => toast.error(`Kunne ikke lagre: ${e.message ?? e}`),
  });
}
