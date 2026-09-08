import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { syncEffectiveDeclarationForRecipe } from "@/varer/lib/effectiveDeclaration";
import { computeStaleness, type StalenessSource, type StalenessResult } from "@/varer/lib/labelStaleness";

interface RecipeLineRow {
  raw_material_id: string | null;
  raw_materials: { name: string | null; updated_at: string | null } | null;
}

/**
 * Kildetidspunkter for oppskriften: oppskriften selv, råvarene og næringsradene.
 * Brukes til å avgjøre om beregningen er utdatert inntil en DB-trigger finnes.
 */
export function useLabelStaleness(recipeId: string | undefined, computedAt: string | null | undefined) {
  const query = useQuery({
    queryKey: ["recipe-label-sources", recipeId],
    enabled: !!recipeId,
    queryFn: async (): Promise<StalenessSource[]> => {
      const { data: recipe, error: rErr } = await supabase
        .from("recipes")
        .select("name, updated_at")
        .eq("id", recipeId!)
        .maybeSingle();
      if (rErr) throw rErr;

      const { data: lines, error: lErr } = await supabase
        .from("recipe_lines")
        .select("raw_material_id, raw_materials(name, updated_at)")
        .eq("recipe_id", recipeId!)
        .limit(500);
      if (lErr) throw lErr;

      const rows = (lines ?? []) as unknown as RecipeLineRow[];
      const rmIds = rows.map((l) => l.raw_material_id).filter((v): v is string => !!v);

      let nutritionRows: { raw_material_id: string; updated_at: string | null }[] = [];
      if (rmIds.length > 0) {
        const { data: nut, error: nErr } = await supabase
          .from("raw_material_nutrition")
          .select("raw_material_id, updated_at")
          .in("raw_material_id", rmIds);
        if (nErr) throw nErr;
        nutritionRows = (nut ?? []) as { raw_material_id: string; updated_at: string | null }[];
      }
      const nameById = new Map(rows.map((l) => [l.raw_material_id, l.raw_materials?.name ?? "Råvare"]));

      const sources: StalenessSource[] = [];
      if (recipe?.updated_at) sources.push({ name: recipe.name ?? "Oppskriften", updatedAt: recipe.updated_at });
      for (const l of rows) {
        if (l.raw_materials?.updated_at) {
          sources.push({ name: l.raw_materials.name ?? "Råvare", updatedAt: l.raw_materials.updated_at });
        }
      }
      for (const n of nutritionRows) {
        if (n.updated_at) {
          sources.push({ name: `${nameById.get(n.raw_material_id) ?? "Råvare"} (næring)`, updatedAt: n.updated_at });
        }
      }
      return sources;
    },
  });

  const result: StalenessResult = computeStaleness(computedAt ?? null, query.data ?? []);
  return { ...query, staleness: result };
}

export interface ApproveDeclarationInput {
  recipeId: string;
  /** Hvilken kilde som skal gjelde etter godkjenningen. */
  mode: "auto" | "manual";
  /** Beregnet innhold som skal overtas som manuell v1 (ved mode = manual og «overta»). */
  adopt?: {
    ingredientText: string | null;
    contains: string[];
    mayContain: string[];
    nutrition: Record<string, number | null> | null;
  } | null;
  /** Merker som godkjennes samtidig. */
  claims?: { grain?: boolean; keyhole?: boolean };
}

/**
 * Godkjenner deklarasjonen: setter kilde, godkjenner-stempel og merker,
 * og synker snapshot til koblede produkter — bare herfra, aldri automatisk.
 */
export function useApproveDeclaration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ApproveDeclarationInput) => {
      const { data: u } = await supabase.auth.getUser();
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {
        declaration_mode: input.mode,
        declaration_updated_at: now,
        declaration_updated_by: u.user?.id ?? null,
        declaration_needs_review: false,
      };
      if (input.mode === "manual" && input.adopt) {
        patch.manual_ingredient_declaration = input.adopt.ingredientText;
        patch.manual_allergen_summary = { contains: input.adopt.contains, may_contain: input.adopt.mayContain };
        patch.manual_nutrition = input.adopt.nutrition;
      }
      if (input.claims && (input.claims.grain != null || input.claims.keyhole != null)) {
        if (input.claims.grain != null) patch.label_claim_grain = input.claims.grain;
        if (input.claims.keyhole != null) patch.label_claim_keyhole = input.claims.keyhole;
        if (input.claims.grain || input.claims.keyhole) {
          patch.label_claims_approved_by = u.user?.id ?? null;
          patch.label_claims_approved_at = now;
        }
      }
      const { error } = await supabase.from("recipes").update(patch as never).eq("id", input.recipeId);
      if (error) throw error;
      const synced = await syncEffectiveDeclarationForRecipe(input.recipeId);
      return { synced };
    },
    onSuccess: ({ synced }, input) => {
      qc.invalidateQueries({ queryKey: ["recipe-detail", input.recipeId] });
      qc.invalidateQueries({ queryKey: ["recipe-label-calculated", input.recipeId] });
      qc.invalidateQueries({ queryKey: ["recipe-linked-products", input.recipeId] });
      qc.invalidateQueries({ queryKey: ["recipes"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success(
        synced > 0 ? `Deklarasjonen er godkjent og synket til ${synced} produkt(er)` : "Deklarasjonen er godkjent",
      );
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Kunne ikke godkjenne deklarasjonen"),
  });
}
