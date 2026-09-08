// Ren rangering av forslag fra Matvaretabellen for en råvare.
// Ingen nettverk — kjøres over matvarene som allerede er lastet i klienten.
//
// Modellen er bygd om etter kontrollen 8. sep 2026: den gamle trigram-scoringen
// ga ALLE kvalifiserte søsken nøyaktig samme poengsum (0,90), slik at margin-
// sperren stoppet hver eneste kobling. Nå rangeres kandidatene strukturelt:
// hovednavn (før komma) mot søket, og kvalifikatoren (etter komma) mot det
// råvarenavnet faktisk sier.

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

/* ------------------------------------------------------------------ *
 * Søkegrunnlag
 * ------------------------------------------------------------------ */

/** Emballasje-, mengde- og salgsord som aldri sier noe om hva varen ER. */
const PACKAGING_WORDS = [
  "bib",
  "slim",
  "bulk",
  "industri",
  "kork",
  "sekk",
  "pose",
  "spann",
  "kartong",
  "krt",
  "eske",
  "bøtte",
  "kasse",
  "dunk",
  "flaske",
  "boks",
  "beger",
  "brett",
  "pk",
  "pakke",
  "stk",
];

/** Merkevarer som skal vekk — også når de sitter foran varenavnet («Tinemelk»). */
const BRAND_WORDS = [
  "tine",
  "regal",
  "eldorado",
  "dansk",
  "q-meieriene",
  "q meieriene",
  "idun",
  "mills",
  "synnøve",
  "prior",
  "first price",
  "asko",
  "meny",
];

const PACKAGE_SIZE_RE = /\b\d+(?:[.,]\d+)?\s*(?:kg|g|gr|l|ltr|liter|ml|cl|dl|stk|pk)\b/gi;
const FRACTION_SIZE_RE = /\b\d+\s*\/\s*\d+\s*(?:kg|g|l|ml|cl|dl)?\b/gi;
const PERCENT_RE = /(\d+(?:[.,]\d+)?)\s*%/g;

function escapeRe(w: string): string {
  return w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Fettprosentene i en tekst, som tall. «3,5 %» → 3.5 */
export function percentValues(text: string | null | undefined): number[] {
  const out: number[] = [];
  for (const m of (text ?? "").toLowerCase().matchAll(PERCENT_RE)) {
    const v = Number(m[1].replace(",", "."));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Innkjøpsnavnet renset for pakningstokens, merkevarer og løse tall.
 * Prosent beholdes — den er et varianthint, ikke støy.
 */
export function cleanPurchaseName(name: string | null | undefined): string {
  let t = ` ${(name ?? "").toLowerCase()} `;
  t = t.replace(/m\/\s*kork/g, " ");
  t = t.replace(PACKAGE_SIZE_RE, " ");
  t = t.replace(FRACTION_SIZE_RE, " ");
  for (const b of BRAND_WORDS) {
    // Merket kan stå alene («TINE Smør») eller klistret foran varen («Tinemelk»).
    t = t.replace(new RegExp(`\\b${escapeRe(b)}\\b`, "g"), " ");
    t = t.replace(new RegExp(`\\b${escapeRe(b)}(?=[a-zæøå]{3,})`, "g"), " ");
  }
  for (const p of PACKAGING_WORDS) t = t.replace(new RegExp(`\\b${escapeRe(p)}\\b`, "g"), " ");
  // Tall uten prosent er mengder, ikke varianter.
  t = t.replace(/\b\d+(?:[.,]\d+)?\b(?!\s*%)/g, " ");
  return t.replace(/\s{2,}/g, " ").trim();
}

interface Query {
  /** Normalisert søketekst uten prosent. */
  text: string;
  /** Fettprosenter fra søket. */
  percents: number[];
}

function makeQuery(source: string): Query | null {
  const text = normalizeForSearch(source);
  if (!text) return null;
  return { text, percents: percentValues(source) };
}

/** Søketekstene vi prøver: deklarasjonsnavn, renset innkjøpsnavn, rått navn. */
export function suggestionQueries(rm: RawMaterialForSuggestion): string[] {
  return buildQueries(rm).map((q) => q.text);
}

function buildQueries(rm: RawMaterialForSuggestion): Query[] {
  const sources = [
    rm.declaration_name ?? "",
    cleanPurchaseName(rm.name),
    suggestDeclarationNameLocal(rm.name),
    rm.name,
  ];
  const out: Query[] = [];
  for (const s of sources) {
    const q = makeQuery(s);
    if (q && !out.some((o) => o.text === q.text && o.percents.join() === q.percents.join())) out.push(q);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Navnestruktur i Matvaretabellen
 * ------------------------------------------------------------------ */

/** Hoveddelen av et matvarenavn: «Hvetemel, siktet» → «hvetemel». */
function head(foodName: string): string {
  return normalizeForSearch((foodName ?? "").split(",")[0] ?? "");
}

/** Kvalifikatorene etter komma, normalisert: «Hvetemel, sammalt, fint» → ["sammalt","fint"]. */
function qualifiers(foodName: string): string[] {
  return (foodName ?? "")
    .split(",")
    .slice(1)
    .map((p) => normalizeForSearch(p))
    .filter(Boolean);
}

/**
 * Kvalifikatoren som er «standardvaren» i sin gruppe. Uten dette ville
 * «Hvetemel, siktet» og «Hvetemel, økologisk» vært like gode treff på «hvetemel».
 * Listen er eksplisitt med vilje — vi gjetter ikke.
 */
export const DEFAULT_QUALIFIERS: Record<string, readonly string[]> = {
  sukker: ["hvitt"],
  hvetemel: ["siktet"],
  rugmel: ["siktet"],
  speltmel: ["siktet"],
  egg: ["ra"],
};

/** «uspesifisert» er standardvarianten i alle grupper. */
const UNIVERSAL_DEFAULT_QUALIFIER = "uspesifisert";

function isDefaultQualifier(foodHead: string, quals: readonly string[]): boolean {
  if (quals.length !== 1) return quals.includes(UNIVERSAL_DEFAULT_QUALIFIER) && quals.length === 1;
  const q = quals[0];
  if (q === UNIVERSAL_DEFAULT_QUALIFIER) return true;
  return (DEFAULT_QUALIFIERS[foodHead] ?? []).includes(q);
}

/**
 * Samleposter som aldri skal kobles automatisk: de finnes bare fordi basen
 * mangler et fettinnhold, og valget må tas av et menneske.
 */
export const MANUAL_ONLY_FOODS: readonly string[] = [
  "Melk, uspesifisert",
  "Ost, uspesifisert",
  "Mel, uspesifisert",
  "Kjøtt, uspesifisert",
];

const MANUAL_ONLY_NORMALIZED = new Set(MANUAL_ONLY_FOODS.map((n) => normalizeForSearch(n)));

/** Sant for generiske samleposter som «Melk, uspesifisert». */
export function isManualOnlyFood(foodName: string | null | undefined): boolean {
  return MANUAL_ONLY_NORMALIZED.has(normalizeForSearch(foodName ?? ""));
}

/* ------------------------------------------------------------------ *
 * Poenggivning
 * ------------------------------------------------------------------ */

/** Fradrag for matvarenavn med kvalifikator etter komma («Sukker, brunt»). */
export const QUALIFIER_PENALTY = 0.12;
/** Tillegg til standardvarianten i en gruppe når søket ikke sier noe annet. */
export const DEFAULT_QUALIFIER_BONUS = 0.1;
/** Tak for treff som bare kommer fra søkeord (search_keywords). */
export const KEYWORD_MAX = 0.85;
/** Poeng når fettprosenten i navnet avviker fra råvarens. */
export const PERCENT_MISMATCH_SCORE = 0.86;

type MatchKind = "exact" | "phrase" | "suffix" | null;

function headMatch(query: string, foodHead: string): MatchKind {
  if (!foodHead) return null;
  if (query === foodHead) return "exact";
  const words = query.split(" ");
  // Hele hovednavnet som ordsekvens i søket («brunt sukker» → «sukker»).
  if (new RegExp(`(^| )${escapeRe(foodHead)}( |$)`).test(query)) return "phrase";
  // Sammensatt uten mellomrom: «lett melk» → «lettmelk».
  for (let i = 0; i + 1 < words.length; i++) {
    if (`${words[i]}${words[i + 1]}` === foodHead) return "phrase";
  }
  // Norske sammensetninger er hodefinale: «meierismør» ER smør, «smøremyk» er det ikke.
  if (foodHead.length >= 4 && words.some((w) => w !== foodHead && w.endsWith(foodHead))) return "suffix";
  return null;
}

function keywordScore(query: string, food: FoodCandidate, hasComma: boolean): number {
  const qWords = searchWords(query);
  let s = 0;
  for (const kw of food.search_keywords ?? []) {
    const k = normalizeForSearch(kw);
    if (!k) continue;
    if (k === query) s = Math.max(s, hasComma ? 0.78 : KEYWORD_MAX);
    else if (k.length >= 4 && qWords.includes(k)) s = Math.max(s, 0.7);
  }
  return Math.min(s, KEYWORD_MAX);
}

interface ScoreResult {
  score: number;
  percentMismatch: boolean;
}

function scoreFood(query: Query, food: FoodCandidate, variantSpecified: boolean): ScoreResult {
  const full = normalizeForSearch(food.food_name);
  const h = head(food.food_name);
  const quals = qualifiers(food.food_name);
  const kind = headMatch(query.text, h);

  if (query.text === full) return { score: 1, percentMismatch: false };

  if (kind) {
    if (quals.length === 0) {
      return { score: kind === "exact" ? 1 : kind === "phrase" ? 0.92 : 0.9, percentMismatch: false };
    }
    const base = kind === "suffix" ? 1 - QUALIFIER_PENALTY - 0.1 : 1 - QUALIFIER_PENALTY;
    const foodPercents = percentValues(food.food_name);

    // Prosent er den skarpeste varianten vi har: den avgjør alene.
    if (query.percents.length > 0 && foodPercents.length > 0) {
      const hit = query.percents.some((p) => foodPercents.includes(p));
      return hit ? { score: 1, percentMismatch: false } : { score: PERCENT_MISMATCH_SCORE, percentMismatch: true };
    }

    // Nevner søket kvalifikatoren eksplisitt («brunt sukker»), er treffet entydig.
    const qWords = new Set(searchWords(query.text));
    if (quals.some((q) => q.split(" ").every((w) => qWords.has(w)))) {
      return { score: 1, percentMismatch: false };
    }

    if (!variantSpecified && isDefaultQualifier(h, quals)) {
      return { score: base + DEFAULT_QUALIFIER_BONUS, percentMismatch: false };
    }
    return { score: base, percentMismatch: false };
  }

  const kw = keywordScore(query.text, food, full !== h);
  if (kw > 0) return { score: kw, percentMismatch: false };

  return { score: Math.min(trigramSimilarity(query.text, full) * 0.9, 0.75), percentMismatch: false };
}

/**
 * Sier søket noe om variant? Da skal ingen «standardvariant» få tillegg.
 * Vi ser på ordene som faktisk skiller søsknene i basen fra hverandre.
 */
function variantSpecifiedFor(query: Query, foods: readonly FoodCandidate[]): boolean {
  if (query.percents.length > 0) return true;
  const qWords = new Set(searchWords(query.text));
  for (const food of foods) {
    const h = head(food.food_name);
    if (!headMatch(query.text, h)) continue;
    for (const q of qualifiers(food.food_name)) {
      if (q === UNIVERSAL_DEFAULT_QUALIFIER) continue;
      if (q.split(" ").some((w) => w.length >= 3 && qWords.has(w))) return true;
    }
  }
  return false;
}

function rankForQuery(
  rm: RawMaterialForSuggestion,
  query: Query,
  foods: readonly FoodCandidate[],
  minConfidence: number,
): { food: FoodCandidate; confidence: number; len: number }[] {
  const variantSpecified = variantSpecifiedFor(query, foods);
  const scored: { food: FoodCandidate; confidence: number; len: number }[] = [];
  for (const food of foods) {
    const { score } = scoreFood(query, food, variantSpecified);
    if (score <= 0) continue;
    // Gruppen brukes bare som straff. Som bonus løftet den alle søsken likt og
    // gjorde poengsummene ubrukelige til å skille dem.
    const fit = foodGroupFit(rm.category, food.food_group_name);
    const confidence = Math.round(score * (fit < 1 ? fit : 1) * 100) / 100;
    if (confidence < minConfidence) continue;
    scored.push({ food, confidence, len: normalizeForSearch(food.food_name).length });
  }
  scored.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      a.len - b.len ||
      a.food.food_name.localeCompare(b.food.food_name, "nb"),
  );
  return scored;
}

/** Topp-N forslag med tillit 0–1. Tom liste for ikke-mat-kategorier. */
export function suggestFoods(
  rm: RawMaterialForSuggestion,
  foods: readonly FoodCandidate[],
  limit = 3,
  minConfidence = 0.35,
): FoodSuggestion[] {
  if (isNonFoodCategory(rm.category)) return [];
  const queries = buildQueries(rm);
  if (queries.length === 0) return [];

  // Det mest presise søket vinner. Deklarasjonsnavnet «melk» skal ikke
  // overstyre at innkjøpsnavnet sier «Helmelk 3,5 %».
  let best: { food: FoodCandidate; confidence: number; len: number }[] = [];
  let bestTop = -1;
  for (const q of queries) {
    const ranked = rankForQuery(rm, q, foods, minConfidence);
    const top = ranked[0]?.confidence ?? 0;
    if (top > bestTop + 1e-9) {
      best = ranked;
      bestTop = top;
    }
  }

  return best.slice(0, limit).map((s) => ({
    food_id: s.food.food_id,
    food_name: s.food.food_name,
    food_group_name: s.food.food_group_name,
    confidence: s.confidence,
  }));
}

/* ------------------------------------------------------------------ *
 * Sikkerhetsvurdering før automatisk kobling
 *
 * Prosenten over er en tekstlikhet, ikke en kalibrert sannsynlighet for at
 * matvaren er riktig. Derfor må masse-kobling sperres når toppforslagene ligger
 * tett, når toppforslaget er en variant råvarenavnet ikke sier noe om, eller når
 * forslaget er en generisk samlepost.
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

/**
 * Variantegenskaper som `label` → verdier. «Melk 0,5 %» gir
 * `fettinnhold → {"0.5 %"}`, «Smør, saltet» gir `salting → {"saltet"}`.
 */
export function variantAttributes(text: string | null | undefined): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const n = normalizeForSearch(text ?? "");
  if (!n) return out;

  const add = (label: string, value: string) => {
    const set = out.get(label) ?? new Set<string>();
    set.add(value);
    out.set(label, set);
  };

  // Prosent leses fra råteksten — normaliseringen fjerner både «,» og «%».
  for (const p of percentValues(text)) add("fettinnhold", `${p} %`);
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

function isPercentValue(value: string): boolean {
  return value.trim().endsWith("%");
}

/**
 * Matvaretabellen skriver alltid fettprosenten i navnet («Melk, hel, 3,5 % fett»),
 * mens innkjøpsnavnet vårt sjelden gjør det. Oppgir råvaren ingen prosent, er
 * prosenten i forslaget en presisering — ikke en konflikt.
 */
function dropUnaskedPercent(
  asked: Map<string, Set<string>>,
  offered: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const askedPct = [...(asked.get("fettinnhold") ?? [])].some(isPercentValue);
  if (askedPct) return offered;
  const set = offered.get("fettinnhold");
  if (!set) return offered;
  const kept = new Set([...set].filter((v) => !isPercentValue(v)));
  const copy = new Map(offered);
  if (kept.size > 0) copy.set("fettinnhold", kept);
  else copy.delete("fettinnhold");
  return copy;
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

  const rmText = [rm.declaration_name ?? "", rm.name].join(" ");
  const askedPct = percentValues(rmText);
  const topPct = percentValues(top.food_name);
  if (askedPct.length > 0 && topPct.length > 0 && !askedPct.some((p) => topPct.includes(p))) {
    return {
      autoLinkAllowed: false,
      reason: `Fettprosent avviker (råvare ${askedPct.join("/")} % · forslag ${topPct.join("/")} %) — velg selv`,
    };
  }

  if (top.confidence < AUTO_LINK_MIN_CONFIDENCE) {
    const plausible = suggestions
      .slice(0, 2)
      .map((s) => s.food_name)
      .join(" / ");
    return { autoLinkAllowed: false, reason: `Usikkert treff — flere plausible: ${plausible} — velg selv` };
  }

  if (isManualOnlyFood(top.food_name)) {
    return { autoLinkAllowed: false, reason: "Generisk samlepost — velg fettinnhold (hel/lett/skummet)" };
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
  const asked = variantAttributes(rmText);
  const offered = dropUnaskedPercent(asked, variantAttributes(top.food_name));
  const labels = new Set([...asked.keys(), ...offered.keys()]);
  for (const label of labels) {
    const a = asked.get(label);
    const o = offered.get(label);
    if (sameValues(a, o)) continue;
    // «Rå» er standardtilstanden: sier råvaren ingenting om tilberedning, er
    // «Egg, rå» det samme som «egg».
    if (label === "tilberedning" && !a && sameValues(o, new Set(["ra"]))) continue;
    return {
      autoLinkAllowed: false,
      reason: `${label} stemmer ikke (råvare: ${describe(a)} · forslag: ${describe(o)}) — velg selv`,
    };
  }

  return { autoLinkAllowed: true, reason: null };
}

/** Sant når matvaregruppen ikke passer råvarekategorien (0,75-straffen). */
export function hasGroupPenalty(
  category: string | null | undefined,
  suggestion: { food_group_name: string | null } | undefined,
): boolean {
  return !!suggestion && foodGroupFit(category, suggestion.food_group_name) < 1;
}
