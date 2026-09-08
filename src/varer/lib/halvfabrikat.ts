import { supabase } from "@/integrations/supabase/client";
import { lineToGrams, type BakersLine } from "@/varer/lib/bakers";

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
function lineCost(line: BakersLine, grams: number): number {
  const price = Number(line._rm?.current_cost_price ?? NaN);
  if (!Number.isFinite(price)) return 0;
  if (line.unit === "stk") return (Number(line.quantity) || 0) * price;
  return (grams / 1000) * price;
}

/** Linjer der mengden ikke kan regnes om til gram — de gjør prisen ubrukelig. */
export function unconvertibleLines(lines: BakersLine[]): BakersLine[] {
  return lines.filter((l) => !lineToGrams(l).exact);
}

/** Forklaring på hvorfor prisen per kg mangler, eller null når den kan regnes ut. */
export function costPerKgBlockedReason(lines: BakersLine[]): string | null {
  const bad = unconvertibleLines(lines);
  if (bad.length === 0) return null;
  const names = bad.map((l) => l._rm?.name ?? l.ingredient_name ?? "ukjent råvare");
  return `Mangler omregning til vekt for ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3} til` : ""}. Legg inn tetthet eller vekt per stk.`;
}

/**
 * Pris per kg = sum linjekost / total deigvekt i kg.
 * Returnerer null når én linje ikke kan regnes om til gram — en liter olje uten
 * tetthet ble tidligere talt som 0 g og 0 kr, og prisen ble dermed for høy.
 */
export function costPerKg(lines: BakersLine[]): number | null {
  if (unconvertibleLines(lines).length > 0) return null;
  let totalGrams = 0;
  let sum = 0;
  for (const l of lines) {
    const g = lineToGrams(l).grams;
    totalGrams += g;
    sum += lineCost(l, g);
  }
  if (totalGrams <= 0) return null;
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
      new Set((lines ?? []).map((l: { raw_material_id: string | null }) => l.raw_material_id).filter(Boolean)),
    ) as string[];
    if (rmIds.length === 0) return false;

    const { data: rms } = await supabase
      .from("raw_materials")
      .select("produced_by_recipe_id")
      .in("id", rmIds)
      .not("produced_by_recipe_id", "is", null);

    const next: string[] = [];
    for (const r of (rms ?? []) as { produced_by_recipe_id: string | null }[]) {
      const rid = r.produced_by_recipe_id;
      if (!rid) continue;
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
