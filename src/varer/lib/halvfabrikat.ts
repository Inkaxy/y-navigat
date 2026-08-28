import { supabase } from "@/integrations/supabase/client";
import { toGrams, type BakersLine } from "@/varer/lib/bakers";

/** Kategorien som markerer at en oppskrift er en grunnoppskrift. */
export const BASE_RECIPE_CATEGORY = "Grunnoppskrift";

/** Enkel slug for SKU-generering. */
export function slugify(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/[æå]/g, "a")
    .replace(/ø/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
}

export function makeSku(name: string): string {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${(slugify(name) || "halvfab").toUpperCase()}-${suffix}`;
}

/** Kostnad for én linje — samme formel som oppskriftskalkylen i PDF-en. */
function lineCost(line: BakersLine): number {
  const price = Number((line as any)._rm?.current_cost_price ?? NaN);
  if (!Number.isFinite(price)) return 0;
  if (line.unit === "stk") return (Number(line.quantity) || 0) * price;
  return (toGrams(line.quantity, line.unit) / 1000) * price;
}

/** Pris per kg = sum linjekost / total deigvekt i kg. */
export function costPerKg(lines: BakersLine[]): number | null {
  const totalGrams = lines.reduce((s, l) => s + toGrams(l.quantity, l.unit), 0);
  if (totalGrams <= 0) return null;
  const sum = lines.reduce((s, l) => s + lineCost(l), 0);
  if (sum <= 0) return null;
  return sum / (totalGrams / 1000);
}

/**
 * Sirkelvern: sjekker om oppskriften `startRecipeId` (rekursivt, maks `maxDepth`
 * nivåer) bruker et halvfabrikat som er laget av `targetRecipeId`.
 */
export async function hasCircularReference(
  startRecipeId: string | null | undefined,
  targetRecipeId: string,
  maxDepth = 5,
): Promise<boolean> {
  if (!startRecipeId) return false;
  if (startRecipeId === targetRecipeId) return true;

  let frontier = [startRecipeId];
  const seen = new Set<string>(frontier);

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const { data: lines } = await supabase
      .from("recipe_lines")
      .select("raw_material_id")
      .in("recipe_id", frontier);
    const rmIds = Array.from(
      new Set((lines ?? []).map((l: any) => l.raw_material_id).filter(Boolean)),
    ) as string[];
    if (rmIds.length === 0) return false;

    const { data: rms } = await supabase
      .from("raw_materials")
      .select("produced_by_recipe_id")
      .in("id", rmIds)
      .not("produced_by_recipe_id", "is", null);

    const next: string[] = [];
    for (const r of (rms ?? []) as any[]) {
      const rid = r.produced_by_recipe_id as string;
      if (rid === targetRecipeId) return true;
      if (!seen.has(rid)) {
        seen.add(rid);
        next.push(rid);
      }
    }
    frontier = next;
  }
  return false;
}
