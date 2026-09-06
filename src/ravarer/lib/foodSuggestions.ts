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

/* ------------------------------------------------------------------ *
 * Sikkerhetsvurdering før automatisk kobling
 *
 * Prosenten over er en tekstlikhet, ikke en kalibrert sannsynlighet for at
 * matvaren er riktig. «Melk, hel» og «Melk, skummet» får begge full score på
 * søket «melk», og sorteringen ville da valgt det korteste navnet. Derfor må
 * masse-kobling sperres når toppforslagene ligger tett, eller når toppforslaget
 * er en variant (fettprosent, rå/kokt/tørket, saltet/usaltet, glutenfri) som
 * råvarenavnet ikke sier noe om.
 * ------------------------------------------------------------------ */

/** Minste avstand mellom forslag 1 og 2 før vi tør å koble automatisk. */
export const AMBIGUITY_MARGIN = 0.08;
/** Laveste tekstlikhet som kan kobles automatisk. */
export const AUTO_LINK_MIN_CONFIDENCE = 0.8;

/**
 * Variantegenskaper med VERDI. Det holder ikke å vite at både råvaren og
 * forslaget nevner «salting» — «usaltet» og «saltet» er motsatte varer.
 */
const VARIANT_WORDS: { label: string; value: string; words: string[] }[] = [
  { label: "fettinnhold", value: "hel", words: ["hel", "helmelk", "full fat", "fet"] },
  { label: "fettinnhold", value: "lett", words: ["lett", "lettmelk"] },
  { label: "fettinnhold", value: "ekstra lett", words: ["ekstra lett"] },
  { label: "fettinnhold", value: "skummet", words: ["skummet", "mager"] },
  { label: "fettinnhold", value: "halvfet", words: ["halvfet"] },
  { label: "tilberedning", value: "ra", words: ["ra", "raa", "ukokt"] },
  { label: "tilberedning", value: "kokt", words: ["kokt"] },
  { label: "tilberedning", value: "stekt", words: ["stekt", "grillet", "bakt", "ristet"] },
  { label: "tilberedning", value: "torket", words: ["torket", "torka"] },
  { label: "tilberedning", value: "hermetisk", words: ["hermetisk"] },
  { label: "tilberedning", value: "frossen", words: ["frossen"] },
  { label: "tilberedning", value: "fersk", words: ["fersk"] },
  { label: "tilberedning", value: "pasteurisert", words: ["pasteurisert"] },
  { label: "salting", value: "saltet", words: ["saltet", "med salt"] },
  { label: "salting", value: "usaltet", words: ["usaltet", "uten salt"] },
  { label: "salting", value: "lettsaltet", words: ["lettsaltet"] },
  { label: "gluten", value: "glutenfri", words: ["glutenfri", "glutenfritt", "uten gluten"] },
  { label: "sukker", value: "sukret", words: ["sukret"] },
  { label: "sukker", value: "usukret", words: ["usukret", "uten sukker", "sukkerfri"] },
];

const PERCENT_RE = /(\d+(?:[.,]\d+)?)\s*%/g;

function escapeRe(w: string): string {
  return w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Variantegenskaper som `label` → verdier. «Melk 0,5 %» gir
 * `fettinnhold → {"0.5 %"}`, «Smør, saltet» gir `salting → {"saltet"}`.
 */
export function variantAttributes(text: string | null | undefined): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const raw = (text ?? "").toLowerCase();
  const n = normalizeForSearch(text ?? "");
  if (!n) return out;

  const add = (label: string, value: string) => {
    const set = out.get(label) ?? new Set<string>();
    set.add(value);
    out.set(label, set);
  };

  // Prosent leses fra råteksten — normaliseringen fjerner både «,» og «%».
  for (const m of raw.matchAll(PERCENT_RE)) {
    add("fettinnhold", `${Number(m[1].replace(",", "."))} %`);
  }
  for (const entry of VARIANT_WORDS) {
    for (const w of entry.words) {
      if (new RegExp(`\\b${escapeRe(w)}\\b`).test(n)) {
        add(entry.label, entry.value);
        break;
      }
    }
  }
  return out;
}

/** Hvilke variantegenskaper en tekst omtaler (uten verdiene). */
export function variantMarkers(text: string | null | undefined): string[] {
  return [...variantAttributes(text).keys()];
}

function sameValues(a: Set<string> | undefined, b: Set<string> | undefined): boolean {
  const av = [...(a ?? [])].sort();
  const bv = [...(b ?? [])].sort();
  return av.length === bv.length && av.every((v, i) => v === bv[i]);
}

function describe(set: Set<string> | undefined): string {
  const v = [...(set ?? [])];
  return v.length > 0 ? v.join("/") : "ikke oppgitt";
}

export interface SuggestionSafety {
  /** Trygt å koble uten at et menneske ser på det. */
  autoLinkAllowed: boolean;
  /** Kort forklaring på norsk når kobling må gjøres manuelt. */
  reason: string | null;
}

/** Kan toppforslaget kobles automatisk, eller må noen velge selv? */
export function assessSuggestions(
  rm: RawMaterialForSuggestion,
  suggestions: readonly FoodSuggestion[],
): SuggestionSafety {
  const top = suggestions[0];
  if (!top) return { autoLinkAllowed: false, reason: "Ingen forslag" };
  if (top.confidence < AUTO_LINK_MIN_CONFIDENCE) {
    return { autoLinkAllowed: false, reason: "For svakt treff — velg selv" };
  }

  const second = suggestions[1];
  if (second && top.confidence - second.confidence < AMBIGUITY_MARGIN) {
    return {
      autoLinkAllowed: false,
      reason: `Flere nesten like treff (${top.food_name} / ${second.food_name}) — velg selv`,
    };
  }

  // Varianter må stemme BEGGE veier, og på verdi — ikke bare på kategori.
  // «Smør usaltet» mot «Smør, saltet» nevner begge salting, men er ulike varer.
  const rmText = [rm.declaration_name ?? "", rm.name].join(" ");
  const asked = variantAttributes(rmText);
  const offered = variantAttributes(top.food_name);
  const labels = new Set([...asked.keys(), ...offered.keys()]);
  for (const label of labels) {
    const a = asked.get(label);
    const o = offered.get(label);
    if (sameValues(a, o)) continue;
    return {
      autoLinkAllowed: false,
      reason: `${label} stemmer ikke (råvare: ${describe(a)} · forslag: ${describe(o)}) — velg selv`,
    };
  }

  return { autoLinkAllowed: true, reason: null };
}
