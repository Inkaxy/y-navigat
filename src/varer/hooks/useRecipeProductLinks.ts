import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/** En vare som er koblet til oppskriften (`product_recipe_links`). */
export interface RecipeProductLinkRow {
  id: string;
  product_id: string;
  is_primary: boolean | null;
  declaration_mode: string | null;
  extra_lines: unknown;
  sales_unit_basis: string | null;
  units_per_sales_unit: number | null;
  sales_unit_weight_g: number | null;
  units_per_batch_override: number | null;
  products: {
    id: string;
    display_name: string | null;
    display_number: number | null;
    status: string | null;
    unit_of_sale: string | null;
    weight_per_unit_grams: number | null;
    calc_type: string | null;
  } | null;
}

const LINK_COLUMNS =
  "id, product_id, is_primary, declaration_mode, extra_lines, sales_unit_basis, units_per_sales_unit, sales_unit_weight_g, units_per_batch_override, products(id, display_name, display_number, status, unit_of_sale, weight_per_unit_grams, calc_type)";

export const RECIPE_LINKS_KEY = (recipeId: string) => ["recipe-links", recipeId] as const;

/**
 * Koblede varer for en oppskrift, med «Koble til produkt» og «Koble fra».
 * Logikken er flyttet uendret fra `RecipeProductLinks`: innsetting lar
 * databasen avgjøre primærflagget, og etter hver endring beregnes merkedata
 * på nytt (`afterLinkChange`).
 */
export function useRecipeProductLinks(recipeId: string, legalEntityId: string | null | undefined) {
  const qc = useQueryClient();
  // Synkron lås før await: et dobbeltklikk skal ikke gi to innsettinger.
  const lockRef = useRef(false);
  const [busy, setBusyState] = useState(false);
  const setBusy = (v: boolean) => {
    lockRef.current = v;
    setBusyState(v);
  };

  const linksQuery = useQuery({
    queryKey: RECIPE_LINKS_KEY(recipeId),
    enabled: !!recipeId,
    queryFn: async (): Promise<RecipeProductLinkRow[]> => {
      const { data, error } = await supabase
        .from("product_recipe_links")
        .select(LINK_COLUMNS)
        .eq("recipe_id", recipeId);
      if (error) throw error;
      return (data ?? []) as RecipeProductLinkRow[];
    },
  });

  const productsQuery = useQuery({
    queryKey: ["all-products-for-link", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, display_name, display_number")
        .eq("legal_entity_id", legalEntityId!)
        .neq("status", "discontinued")
        .order("display_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  async function afterLinkChange() {
    try {
      const { error } = await supabase.functions.invoke("compute-recipe-label", { body: { recipe_id: recipeId } });
      if (error) throw error;
    } catch (e) {
      console.error("compute-recipe-label", e);
      toast.warning("Koblingen er lagret, men merkedata ble ikke beregnet på nytt. Bruk «Beregn på nytt».");
    }
    await linksQuery.refetch();
    qc.invalidateQueries({ queryKey: ["recipe-label-calculated", recipeId] });
    qc.invalidateQueries({ queryKey: ["recipe-linked-products", recipeId] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["product-margins"] });
  }

  /** Returnerer sann når koblingen ble lagret. */
  async function addLink(productId: string): Promise<boolean> {
    if (lockRef.current) return false;
    setBusy(true);
    try {
      // DB-en avgjør selv om koblingen blir primær (første kobling for produktet).
      const { error } = await supabase
        .from("product_recipe_links")
        .insert({ product_id: productId, recipe_id: recipeId } as never);
      if (error) {
        if (error.code === "42501") toast.error("Mangler skrivetilgang til oppskriften");
        else if (error.code === "23514") toast.error("Sirkulær referanse — oppskriften kan ikke kobles til seg selv (via halvfabrikat)");
        else toast.error(error.message);
        return false;
      }
      toast.success("Produkt koblet til oppskrift");
      await afterLinkChange();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function removeLink(linkId: string, isCurrent: boolean): Promise<void> {
    if (isCurrent) {
      toast.error("Du kan ikke koble fra produktet du er på nå.");
      return;
    }
    if (lockRef.current) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("product_recipe_links").delete().eq("id", linkId);
      if (error) {
        toast.error(error.message);
        return;
      }
      await afterLinkChange();
    } finally {
      setBusy(false);
    }
  }

  return { linksQuery, productsQuery, addLink, removeLink, busy };
}
