import { supabase } from "@/integrations/supabase/client";

/**
 * Databasetriggerne `trg_recipe_lines_h4_no_cycle` og `trg_prl_h4_no_cycle` stopper
 * halvfabrikater som (direkte eller indirekte) bruker seg selv. Meldingen derfra er
 * teknisk — her oversettes den til noe en baker kan handle på.
 */
export function halvfabrikatErrorText(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("cycle") || m.includes("sirkel") || m.includes("h4_no_cycle")) {
    return "Denne oppskriften brukes allerede av halvfabrikatet du prøver å lage. Fjern koblingen først.";
  }
  if (m.includes("duplicate") || m.includes("unique")) {
    return "Det finnes allerede et halvfabrikat for denne oppskriften.";
  }
  if (m.includes("permission") || m.includes("row-level security")) {
    return "Du mangler tilgang til å opprette halvfabrikat.";
  }
  return message;
}

/** Lager en enkel, stabil varekode av oppskriftsnavnet. */
export function halvfabrikatCode(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "halvfabrikat";
  return `HF-${slug}`;
}

export interface SaveAsHalvfabrikatInput {
  recipeId: string;
  recipeName: string;
  legalEntityId: string;
}

/**
 * Oppretter et halvfabrikat-produkt for oppskriften og kobler oppskriften som
 * primær. Finnes produktet allerede, gjenbrukes det.
 */
export async function saveAsHalvfabrikat(input: SaveAsHalvfabrikatInput): Promise<string> {
  const { data: existing, error: existingError } = await supabase
    .from("product_recipe_links")
    .select("product_id, products!inner(id, calc_type)")
    .eq("recipe_id", input.recipeId)
    .eq("products.calc_type", "halvfabrikat")
    .limit(1);
  if (existingError) throw new Error(halvfabrikatErrorText(existingError.message));
  const existingId = existing?.[0]?.product_id ?? null;
  if (existingId) return existingId;

  const { data: userData } = await supabase.auth.getUser();
  const { data: product, error } = await supabase
    .from("products")
    .insert({
      legal_entity_id: input.legalEntityId,
      code: halvfabrikatCode(input.recipeName),
      display_name: input.recipeName,
      product_category: "Halvfabrikat",
      calc_type: "halvfabrikat",
      status: "active",
      is_for_sale: false,
      include_in_price_lists: false,
      created_by: userData.user?.id ?? null,
    } as never)
    .select("id")
    .single();
  if (error) throw new Error(halvfabrikatErrorText(error.message));

  const { error: linkError } = await supabase.from("product_recipe_links").insert({
    product_id: product.id,
    recipe_id: input.recipeId,
    is_primary: true,
  } as never);
  if (linkError) {
    // Rydd opp så det ikke blir liggende igjen et halvfabrikat uten oppskrift.
    await supabase.from("products").delete().eq("id", product.id);
    throw new Error(halvfabrikatErrorText(linkError.message));
  }
  return product.id;
}
