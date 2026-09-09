// Ren, testbar bygging av inputs_hash for recipe_label_calculated.
// Hashen fanger alt som kan gjøre en tidligere beregning utdatert: linjene på
// oppskriften, yield-feltene og fakta om hver involverte råvare (deklarasjon,
// vanninnhold, kornklassifisering, kornart, stykkvekt, allergener og når
// næringsraden sist ble oppdatert). Endrer noe av dette seg, endrer hashen seg.

export interface HashLineInput {
  raw_material_id: string | null;
  sub_product_id: string | null;
  ingredient_name: string | null;
  grams: number | null;
  waste_percent: number | null;
  include_in_declaration: boolean;
  custom_declaration_text: string | null;
}

export interface HashYieldInput {
  yield_grams: number | null;
  yield_loss_pct: number | null;
  finished_weight_grams: number | null;
  yield_quantity: number | null;
  yield_unit: string | null;
}

export interface HashMaterialFact {
  raw_material_id: string;
  declaration_name: string | null;
  water_content_pct: number | null;
  grain_classification: string | null;
  cereal_type: string | null;
  unit_weight_grams: number | null;
  /** Sorterte allergennavn (contains + may_contain slått sammen holdes utenfor — bare navnene som er registrert). */
  allergens: string[];
  /** updated_at fra raw_material_nutrition — null hvis råvaren mangler næringsrad. */
  nutrition_updated_at: string | null;
}

/** Kanonisk, deterministisk JSON — samme innhold gir alltid samme streng uansett rekkefølge på nøkler/materialer. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = canonicalize(obj[key]);
    return out;
  }
  return value;
}

export function buildInputsHashPayload(
  lines: HashLineInput[],
  yieldFields: HashYieldInput,
  materials: HashMaterialFact[],
): unknown {
  const sortedMaterials = [...materials]
    .map((m) => ({ ...m, allergens: [...m.allergens].sort() }))
    .sort((a, b) => a.raw_material_id.localeCompare(b.raw_material_id));
  return canonicalize({
    lines,
    yield: yieldFields,
    materials: sortedMaterials,
  });
}

/** SHA-256 (hex) av den kanoniske JSON-representasjonen. */
export async function buildInputsHash(
  lines: HashLineInput[],
  yieldFields: HashYieldInput,
  materials: HashMaterialFact[],
): Promise<string> {
  const payload = JSON.stringify(buildInputsHashPayload(lines, yieldFields, materials));
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
