import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/** Overstyringer godkjenningen kan sende med — alle valgfrie, men objektet sendes alltid. */
export interface ApproveDeclarationOverrides {
  ingredient_text?: string | null;
  ingredient_html?: string | null;
  allergens_contains?: string[];
  allergens_may_contain?: string[];
  nutrition_per_100g?: Record<string, number | null> | null;
  coverage_pct?: number | null;
  net_weight_g?: number | null;
  shelf_life_days?: number | null;
  storage_text?: string | null;
  origin_text?: string | null;
  claim_keyhole?: boolean;
  claim_grain?: boolean;
  breadscale_pct?: number | null;
}

export interface ApproveDeclarationInput {
  recipeId: string;
  source: "calculated" | "manual";
  overrides?: ApproveDeclarationOverrides;
}

export interface ApproveDeclarationResult {
  versionId: string;
  version: number;
  productsUpdated: number;
}

/** Feilen ved «Beregningen er utdatert» — tilbyr «Beregn på nytt» og ny godkjenning. */
export class DeclarationStaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeclarationStaleError";
  }
}

function mapApproveError(error: { code?: string; message: string }): Error {
  if (error.code === "42501") return new Error("Du mangler tilgang til å godkjenne denne deklarasjonen.");
  if (error.code === "P0002") return new Error("Ingen beregning finnes ennå — beregn merkedata først.");
  if (error.code === "P0001" && /utdatert/i.test(error.message)) return new DeclarationStaleError(error.message);
  if (error.code === "P0001") return new Error(error.message);
  if (error.code === "22023") return new Error(error.message);
  return new Error(error.message);
}

/**
 * Godkjenner deklarasjonen via `approve_recipe_declaration`. RPC-en skriver selv
 * `recipes.declaration_mode` / `*_approved_*` og `products.manual_*` /
 * `declaration_version_id` / `declaration_needs_review` — frontend gjør ingen
 * direkte update lenger.
 */
export function useApproveDeclaration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ApproveDeclarationInput): Promise<ApproveDeclarationResult> => {
      // p_overrides sendes ALLTID, minst som tomt objekt.
      const { data, error } = await supabase.rpc("approve_recipe_declaration", {
        p_recipe_id: input.recipeId,
        p_source: input.source,
        p_overrides: (input.overrides ?? {}) as never,
      });
      if (error) throw mapApproveError(error);
      const d = (data ?? {}) as { version_id: string; version: number; products_updated: number };
      return { versionId: d.version_id, version: d.version, productsUpdated: d.products_updated };
    },
    onSuccess: (res, input) => {
      qc.invalidateQueries({ queryKey: ["recipe-detail", input.recipeId] });
      qc.invalidateQueries({ queryKey: ["recipe-label-calculated", input.recipeId] });
      qc.invalidateQueries({ queryKey: ["recipe-linked-products", input.recipeId] });
      qc.invalidateQueries({ queryKey: ["recipe-declaration-versions", input.recipeId] });
      qc.invalidateQueries({ queryKey: ["recipes"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success(
        res.productsUpdated > 0
          ? `Deklarasjonen er godkjent (v${res.version}) og synket til ${res.productsUpdated} produkt(er)`
          : `Deklarasjonen er godkjent (v${res.version})`,
      );
    },
    onError: (e: unknown) => {
      if (e instanceof DeclarationStaleError) return; // håndteres av kalleren (tilbyr «Beregn på nytt»)
      toast.error((e as Error).message ?? "Kunne ikke godkjenne deklarasjonen");
    },
  });
}

export interface RecipeDeclarationVersion {
  id: string;
  version: number;
  source: string;
  approved_at: string;
  approved_by: string | null;
  diff_from_previous: unknown;
  ingredient_text: string | null;
  ingredient_html: string | null;
  allergens_contains: string[];
  allergens_may_contain: string[];
  nutrition_per_100g: unknown;
  coverage_pct: number | null;
  net_weight_g: number | null;
  shelf_life_days: number | null;
  storage_text: string | null;
  origin_text: string | null;
  claim_grain: boolean;
  claim_keyhole: boolean;
  breadscale_pct: number | null;
  restored_from_version_id: string | null;
}

/** Versjonshistorikk for en oppskrifts deklarasjon, nyeste først. */
export function useRecipeDeclarationVersions(recipeId: string | undefined) {
  return useQuery({
    queryKey: ["recipe-declaration-versions", recipeId],
    enabled: !!recipeId,
    queryFn: async (): Promise<RecipeDeclarationVersion[]> => {
      const { data, error } = await supabase
        .from("recipe_declaration_versions")
        .select(
          "id, version, source, approved_at, approved_by, diff_from_previous, ingredient_text, ingredient_html, allergens_contains, allergens_may_contain, nutrition_per_100g, coverage_pct, net_weight_g, shelf_life_days, storage_text, origin_text, claim_grain, claim_keyhole, breadscale_pct, restored_from_version_id",
        )
        .eq("recipe_id", recipeId!)
        .order("version", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RecipeDeclarationVersion[];
    },
  });
}

/** Gjenoppretter en tidligere deklarasjonsversjon. */
export function useRestoreRecipeDeclaration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (versionId: string) => {
      const { data, error } = await supabase.rpc("restore_recipe_declaration", { p_version_id: versionId });
      if (error) throw mapApproveError(error);
      return data as { version_id: string; version: number; products_updated?: number };
    },
    onSuccess: (_res, _versionId) => {
      qc.invalidateQueries({ queryKey: ["recipe-detail"] });
      qc.invalidateQueries({ queryKey: ["recipe-label-calculated"] });
      qc.invalidateQueries({ queryKey: ["recipe-declaration-versions"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Versjonen er gjenopprettet");
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Kunne ikke gjenopprette versjonen"),
  });
}
