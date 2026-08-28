import { supabase } from "@/integrations/supabase/client";

/**
 * Kopierer en oppskrift med alle deler, linjer, prosesstrinn, arbeidslinjer og
 * emballasjelinjer. Kopien får navn «{navn} (kopi)», status «draft» og står helt
 * uten produktkoblinger — det er hele poenget: samme oppskrift, ny kombinasjon.
 *
 * Kopieres IKKE:
 *  - `product_recipe_links` (kopien er ukoblet)
 *  - halvfabrikat-koblingen (`raw_materials.produced_by_recipe_id` peker fortsatt
 *    på originalen)
 *  - `recipe_label_calculated` (beregnes på nytt ved lagring)
 *
 * Feiler noe underveis slettes den halvferdige kopien igjen, slik at basen aldri
 * står igjen med et halvt duplikat.
 */

type Row = Record<string, unknown>;

/** Felter som aldri skal følge med i en kopi. */
const RECIPE_SKIP = new Set(["id", "created_at", "updated_at", "created_by"]);
const CHILD_SKIP = new Set(["id", "recipe_id", "created_at", "updated_at"]);

function stripped(row: Row, skip: Set<string>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (!skip.has(k)) out[k] = v;
  return out;
}

async function fetchChildren(table: string, recipeId: string): Promise<Row[]> {
  const { data, error } = await supabase
    .from(table as never)
    .select("*")
    .eq("recipe_id", recipeId);
  if (error) {
    // 42P01 = relation does not exist — tabellen mangler i eldre miljøer, tom liste er riktig.
    if ((error as { code?: string }).code === "42P01") return [];
    // Alt annet (nett, RLS, timeout) må stoppe kopieringen — ellers får brukeren
    // en «vellykket» kopi som mangler data uten å vite det.
    throw new Error(`${table}: ${error.message}`);
  }
  return (data ?? []) as unknown as Row[];
}


export async function copyRecipe(recipeId: string): Promise<string> {
  const { data: original, error: readErr } = await supabase
    .from("recipes")
    .select("*")
    .eq("id", recipeId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!original) throw new Error("Fant ikke oppskriften som skulle kopieres");

  const src = original as unknown as Row;
  const payload: Row = {
    ...stripped(src, RECIPE_SKIP),
    name: `${(src.name as string | null) ?? "Oppskrift"} (kopi)`,
    status: "draft",
    product_id: null,
    valid_to: null,
  };

  const { data: created, error: insErr } = await supabase
    .from("recipes")
    .insert(payload as never)
    .select("id")
    .single();
  if (insErr) throw new Error(insErr.message);
  const newId = created.id as string;

  try {
    // --- Deler (nye id-er, gammel id → ny id for linjene) ---
    const parts = await fetchChildren("recipe_parts", recipeId);
    const partIdMap = new Map<string, string>();
    for (const p of [...parts].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))) {
      const { data: np, error } = await supabase
        .from("recipe_parts")
        .insert({ ...stripped(p, CHILD_SKIP), recipe_id: newId } as never)
        .select("id")
        .single();
      if (error) throw new Error(`Del «${String(p.name ?? "")}»: ${error.message}`);
      partIdMap.set(String(p.id), np.id as string);
    }

    // --- Ingredienslinjer (remappet til de nye delene) ---
    const lines = await fetchChildren("recipe_lines", recipeId);
    if (lines.length > 0) {
      const rows = lines.map((l) => {
        const oldPart = l.recipe_part_id == null ? null : String(l.recipe_part_id);
        return {
          ...stripped(l, CHILD_SKIP),
          recipe_id: newId,
          recipe_part_id: oldPart ? partIdMap.get(oldPart) ?? null : null,
        };
      });
      const { error } = await supabase.from("recipe_lines").insert(rows as never);
      if (error) throw new Error(`Ingredienslinjer: ${error.message}`);
    }

    // --- Prosesstrinn, arbeid og emballasje ---
    for (const table of ["recipe_steps", "recipe_labor_lines", "recipe_packaging_lines"] as const) {
      const rows = await fetchChildren(table, recipeId);
      if (rows.length === 0) continue;
      const { error } = await supabase
        .from(table)
        .insert(rows.map((r) => ({ ...stripped(r, CHILD_SKIP), recipe_id: newId })) as never);
      if (error) throw new Error(`${table}: ${error.message}`);
    }

    return newId;
  } catch (err) {
    // Rydd opp: en halvferdig kopi er verre enn ingen kopi.
    await supabase.from("recipes").delete().eq("id", newId);
    throw err instanceof Error ? err : new Error("Kopieringen feilet");
  }
}
