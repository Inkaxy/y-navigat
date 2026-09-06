// Ren rangering av forslag fra Matvaretabellen for en råvare.
// Ingen nettverk — kjøres over matvarene som allerede er lastet i klienten.

import { normalizeForSearch, searchWords, trigramSimilarity } from "@/lib/textSimilarity";
import { suggestDeclarationNameLocal } from "@/ravarer/lib/declarationName";
import { foodGroupFit, isNonFoodCategory } from "@/ravarer/lib/matvaretabellenGroups";

export interface FoodCandidate {
  food_id: string;
  food_name: string;
  food_group_name: string | null;
  search_keywords?: string[] | null;
}

export interface RawMaterialForSuggestion {
  name: string;
  declaration_name?: string | null;
  category?: string | null;
}

export interface FoodSuggestion {
  food_id: string;
  food_name: string;
  food_group_name: string | null;
  confidence: number;
}

/** Søketekstene vi prøver: deklarasjonsnavn, renset innkjøpsnavn, rått navn. */
export function suggestionQueries(rm: RawMaterialForSuggestion): string[] {
  const raw = [rm.declaration_name ?? "", suggestDeclarationNameLocal(rm.name), rm.name];
  const out: string[] = [];
  for (const q of raw) {
    const n = normalizeForSearch(q);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Hoveddelen av et matvarenavn: «Hvetemel, siktet» → «hvetemel». */
function head(foodName: string): string {
  return normalizeForSearch((foodName ?? "").split(",")[0] ?? "");
}

/** Grunnpoeng 0–1 for én matvare mot ett søk. */
function scoreQuery(query: string, food: FoodCandidate): number {
  const full = normalizeForSearch(food.food_name);
  const h = head(food.food_name);
  const qWords = searchWords(query);
  let s = trigramSimilarity(query, full);

  if (h) {
    if (query === h) s = Math.max(s, 1);
    else if (qWords.includes(h)) s = Math.max(s, 0.88);
    else if (query.startsWith(`${h} `)) s = Math.max(s, 0.85);
    else if (h.length >= 5 && query.includes(h)) s = Math.max(s, 0.72);
  }
  if (full.startsWith(`${query} `)) s = Math.max(s, 0.8);

  for (const kw of food.search_keywords ?? []) {
    const k = normalizeForSearch(kw);
    if (!k) continue;
    if (k === query) s = Math.max(s, 0.95);
    else if (k.length >= 4 && qWords.includes(k)) s = Math.max(s, 0.82);
  }
  return s;
}

/** Topp-N forslag med tillit 0–1. Tom liste for ikke-mat-kategorier. */
export function suggestFoods(
  rm: RawMaterialForSuggestion,
  foods: readonly FoodCandidate[],
  limit = 3,
  minConfidence = 0.35,
): FoodSuggestion[] {
  if (isNonFoodCategory(rm.category)) return [];
  const queries = suggestionQueries(rm);
  if (queries.length === 0) return [];

  const scored: { food: FoodCandidate; confidence: number; len: number }[] = [];
  for (const food of foods) {
    let base = 0;
    for (let i = 0; i < queries.length; i++) {
      // Det rå innkjøpsnavnet er minst pålitelig og vektes litt ned.
      const weight = i === queries.length - 1 && queries.length > 1 ? 0.95 : 1;
      const s = scoreQuery(queries[i], food) * weight;
      if (s > base) base = s;
    }
    if (base <= 0) continue;
    const confidence = Math.min(1, base * foodGroupFit(rm.category, food.food_group_name));
    if (confidence < minConfidence) continue;
    scored.push({ food, confidence, len: normalizeForSearch(food.food_name).length });
  }

  scored.sort((a, b) => b.confidence - a.confidence || a.len - b.len || a.food.food_name.localeCompare(b.food.food_name, "nb"));
  return scored.slice(0, limit).map((s) => ({
    food_id: s.food.food_id,
    food_name: s.food.food_name,
    food_group_name: s.food.food_group_name,
    confidence: Math.round(s.confidence * 100) / 100,
  }));
}
