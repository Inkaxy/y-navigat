// Leser oppskriftslinjer og bretter ut halvfabrikater, slik at ingredienser og
// allergener forplanter seg oppover i stedet for å forsvinne.
// Deles av compute-recipe-label og compute-product-declaration — ÉN motor.

import { gramsAfterWaste, toGrams, type TopLine } from "./declaration-core.ts";
import { resolveFinalWeight } from "./units-recipe.ts";

/** Maks nivåer halvfabrikat-i-halvfabrikat som følges. Beskytter mot sykluser. */
export const MAX_SUB_DEPTH = 4;

export const LINE_SELECT =
  "id, raw_material_id, sub_product_id, ingredient_name, quantity, unit, waste_percent, include_in_declaration, is_quid_relevant, custom_declaration_text, water_content_pct_override, sort_order, raw_materials(id, name, unit_weight_grams, is_composite, grain_classification, cereal_type, water_content_pct, components_reviewed_at, produced_by_recipe_id)";

const RECIPE_SELECT = "id, name, yield_grams, yield_loss_pct, finished_weight_grams, yield_quantity, yield_unit";

/** Ferdigvekt for en oppskrift (kun tallet) — brukes for halvfabrikater. */
export function finalWeightOf(recipe: unknown, inputGrams: number): number {
  return resolveFinalWeight(recipe as never, inputGrams).grams;
}

/** Innveid mengde som faktisk er i produktet, summert over linjene. */
export function sumLineGrams(lines: TopLine[]): number {
  return lines.reduce(
    (sum, l) => sum + gramsAfterWaste(toGrams(l.quantity, l.unit, l.unit_weight_grams), l.waste_percent),
    0,
  );
}

export async function expandRecipeLines(
  service: any,
  recipeId: string,
  depth: number,
  seen: Set<string>,
  warnings: string[],
): Promise<TopLine[]> {
  const { data: lines } = await service
    .from("recipe_lines")
    .select(LINE_SELECT)
    .eq("recipe_id", recipeId)
    .order("sort_order");

  const out: TopLine[] = [];
  for (const l of (lines ?? []) as any[]) {
    const rm = l.raw_materials;
    const base: TopLine = {
      source: "master",
      raw_material: rm ?? null,
      raw_material_id: l.raw_material_id ?? null,
      name: rm?.name ?? l.ingredient_name ?? "(ukjent)",
      quantity: Number(l.quantity) || 0,
      unit: l.unit ?? "g",
      waste_percent: Number(l.waste_percent) || 0,
      include: l.include_in_declaration !== false,
      is_quid: !!l.is_quid_relevant,
      custom_text: l.custom_declaration_text || null,
      unit_weight_grams: rm?.unit_weight_grams ?? null,
      water_content_pct_override: l.water_content_pct_override ?? null,
    };

    // En råvare som produseres av en egen oppskrift er også et halvfabrikat.
    let subRecipeId: string | null = rm?.produced_by_recipe_id ?? null;

    if (!l.sub_product_id && !subRecipeId) {
      out.push(base);
      continue;
    }

    const neededGrams = gramsAfterWaste(
      toGrams(base.quantity, base.unit, base.unit_weight_grams),
      base.waste_percent,
    );
    if (neededGrams <= 0) {
      out.push(base);
      continue;
    }

    if (depth >= MAX_SUB_DEPTH) {
      warnings.push(`Halvfabrikat «${base.name}» går dypere enn ${MAX_SUB_DEPTH} nivåer — ingrediensene er ikke regnet med`);
      out.push(base);
      continue;
    }

    if (!subRecipeId && l.sub_product_id) {
      const { data: link } = await service
        .from("product_recipe_links")
        .select("recipe_id, is_primary")
        .eq("product_id", l.sub_product_id)
        .order("is_primary", { ascending: false })
        .limit(1)
        .maybeSingle();
      subRecipeId = link?.recipe_id ?? null;
    }

    if (!subRecipeId || seen.has(subRecipeId)) {
      if (subRecipeId) warnings.push(`Halvfabrikat «${base.name}» peker i ring — hoppet over`);
      else warnings.push(`Halvfabrikat «${base.name}» mangler oppskrift — ingrediensene er ikke regnet med`);
      out.push(base);
      continue;
    }

    const { data: subRecipe } = await service
      .from("recipes")
      .select(RECIPE_SELECT)
      .eq("id", subRecipeId)
      .maybeSingle();

    const subLines = await expandRecipeLines(
      service,
      subRecipeId,
      depth + 1,
      new Set([...seen, subRecipeId]),
      warnings,
    );
    const subInput = sumLineGrams(subLines);
    const subFinal = finalWeightOf(subRecipe, subInput);
    if (subFinal <= 0 || subInput <= 0) {
      warnings.push(`Halvfabrikat «${base.name}» mangler vekt — ingrediensene er ikke regnet med`);
      out.push(base);
      continue;
    }

    // Skaler halvfabrikatets ingredienser til andelen som faktisk brukes her.
    const factor = neededGrams / subFinal;
    for (const sl of subLines) {
      out.push({
        ...sl,
        quantity: gramsAfterWaste(toGrams(sl.quantity, sl.unit, sl.unit_weight_grams), sl.waste_percent) * factor,
        unit: "g",
        waste_percent: 0,
        include: base.include && sl.include,
      });
    }
  }
  return out;
}
