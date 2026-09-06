import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface MissingNutritionRow {
  raw_material_id: string | null;
  name: string;
  grams: number;
  pct_of_dough: number;
}

export interface DatasheetLite {
  id: string;
  raw_material_id: string;
  file_path: string;
  file_name: string | null;
  ai_extracted: any | null;
  uploaded_at: string | null;
}

/** Nyeste datablad per råvare, for de råvarene som mangler næringsdata. */
export function useDatasheetsFor(rawMaterialIds: string[]) {
  const key = [...rawMaterialIds].sort().join(",");
  return useQuery({
    queryKey: ["datasheets-for-missing", key],
    enabled: rawMaterialIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_datasheets")
        .select("id, raw_material_id, file_path, file_name, ai_extracted, uploaded_at")
        .in("raw_material_id", rawMaterialIds)
        .eq("is_current", true)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      const byRm = new Map<string, DatasheetLite>();
      for (const d of (data ?? []) as DatasheetLite[]) {
        if (d.raw_material_id && !byRm.has(d.raw_material_id)) byRm.set(d.raw_material_id, d);
      }
      return byRm;
    },
  });
}

/**
 * Leser ut næringsdata fra et eksisterende datablad og skriver det til råvaren.
 * Kjører AI-uttrekk først dersom databladet aldri er lest ut.
 */
export function useExtractNutritionFromDatasheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { datasheet: DatasheetLite; raw_material_id: string }) => {
      let extracted = input.datasheet.ai_extracted;
      if (!extracted?.nutrition) {
        const { data, error } = await supabase.functions.invoke("extract-datasheet", {
          body: { file_path: input.datasheet.file_path, raw_material_id: input.raw_material_id },
        });
        if (error) throw new Error(`AI-uttrekk feilet: ${error.message}`);
        if ((data as any)?.error) throw new Error(`AI-uttrekk: ${(data as any).error}`);
        const { data: row } = await supabase
          .from("raw_material_datasheets")
          .select("ai_extracted")
          .eq("id", (data as any)?.datasheet_id ?? input.datasheet.id)
          .maybeSingle();
        extracted = row?.ai_extracted;
      }
      if (!extracted?.nutrition) throw new Error("Databladet inneholder ingen næringstabell vi klarte å lese");

      const { data: applied, error: applyErr } = await supabase.functions.invoke("apply-datasheet-update", {
        body: {
          datasheet_id: input.datasheet.id,
          raw_material_id: input.raw_material_id,
          accepted_fields: ["nutrition", "allergens", "ingredient_declaration"],
        },
      });
      if (applyErr) throw new Error(`Kunne ikke lagre: ${applyErr.message}`);
      if ((applied as any)?.error) throw new Error((applied as any).error);
      const failures = (applied as any)?.failures as string[] | undefined;
      if (Array.isArray(failures) && failures.length > 0) {
        throw new Error(`Noe ble ikke lagret: ${failures.join(" · ")}`);
      }
      return applied;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["datasheets-for-missing"] });
      qc.invalidateQueries({ queryKey: ["raw-material-nutrition"] });
      toast.success("Næringsdata lest ut fra databladet");
    },
    onError: (e: any) => toast.error(e.message ?? "Uttrekk feilet"),
  });
}

/** Manuell registrering av næringsdata på en råvare. */
export function useSaveRawMaterialNutrition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { raw_material_id: string; values: Record<string, number | null> }) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("raw_material_nutrition").upsert(
        {
          raw_material_id: input.raw_material_id,
          ...input.values,
          source: "manual",
          verified_at: new Date().toISOString(),
          verified_by: u.user?.id ?? null,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "raw_material_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["raw-material-nutrition"] });
      toast.success("Næringsdata lagret");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useRawMaterialNutrition(rawMaterialId: string | undefined) {
  return useQuery({
    queryKey: ["raw-material-nutrition", rawMaterialId],
    enabled: !!rawMaterialId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_nutrition")
        .select("*")
        .eq("raw_material_id", rawMaterialId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
