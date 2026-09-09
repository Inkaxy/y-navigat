import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Etikettprofilen som gjelder for oppskriftens hovedprodukt. */
export interface RecipeLabelProfile {
  id: string;
  name: string;
  paper_width_mm: number;
  paper_height_mm: number;
  company_name: string | null;
  company_note: string | null;
}

/** mm → punkt (72 punkt per tomme). */
export function mmToPt(mm: number): number {
  return (mm / 25.4) * 72;
}

/**
 * Finner etikettprofilen via produktet som er koblet som primært til oppskriften.
 * Uten kobling eller uten valgt profil returneres null — forhåndsvisningen faller
 * da tilbake til standardstørrelsene.
 */
export function useRecipeLabelProfile(recipeId: string | undefined) {
  return useQuery({
    queryKey: ["recipe-label-profile", recipeId],
    enabled: !!recipeId,
    queryFn: async (): Promise<RecipeLabelProfile | null> => {
      const { data: links, error: linkError } = await supabase
        .from("product_recipe_links")
        .select("product_id, is_primary")
        .eq("recipe_id", recipeId!)
        .order("is_primary", { ascending: false })
        .limit(1);
      if (linkError) throw linkError;
      const productId = links?.[0]?.product_id ?? null;
      if (!productId) return null;

      const { data: product, error: productError } = await supabase
        .from("products")
        .select("label_profile_id")
        .eq("id", productId)
        .maybeSingle();
      if (productError) throw productError;
      const profileId = product?.label_profile_id ?? null;
      if (!profileId) return null;

      const { data: profile, error: profileError } = await supabase
        .from("label_print_profiles")
        .select("id, name, paper_width_mm, paper_height_mm, company_name, company_note, status")
        .eq("id", profileId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile || profile.status !== "active") return null;

      return {
        id: profile.id,
        name: profile.name,
        paper_width_mm: Number(profile.paper_width_mm),
        paper_height_mm: Number(profile.paper_height_mm),
        company_name: profile.company_name ?? null,
        company_note: profile.company_note ?? null,
      };
    },
  });
}
