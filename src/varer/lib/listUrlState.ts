/**
 * Søk, filtre, sortering og side for Varer-listene, lagret i URL-en.
 *
 * Alle verdier valideres og avgrenses: ukjente eller ugyldige verdier faller
 * tilbake til standard, og parametre listen ikke eier, bevares urørt.
 */
import type { LabelingStatus } from "@/varer/lib/labelStaleness";

const MAX_TEXT = 200;
const MAX_PAGE = 9999;
// eslint-disable-next-line no-control-regex -- kontrolltegn skal avvises
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

const LABELING_VALUES: readonly LabelingStatus[] = ["approved", "stale", "missing"];

function oneOf<T extends string>(raw: string | null, allowed: readonly T[]): T | null {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

/** Fritekst: uten kontrolltegn og maks 200 tegn. */
export function cleanText(raw: string | null): string {
  if (!raw) return "";
  return raw.replace(CONTROL_CHARS, "").slice(0, MAX_TEXT);
}

/** Side ≥ 1, heltall, med øvre grense. Ugyldig gir 1. */
export function cleanPage(raw: string | null): number {
  if (!raw || !/^\d{1,5}$/.test(raw)) return 1;
  const n = Number(raw);
  return n >= 1 ? Math.min(n, MAX_PAGE) : 1;
}

/** Skriver bare listens egne nøkler; standardverdier fjernes fra URL-en. */
function writeManaged(
  current: URLSearchParams,
  entries: [string, string | number, string | number][],
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const [key, value, fallback] of entries) {
    next.delete(key);
    if (value !== fallback && value !== "") next.set(key, String(value));
  }
  return next;
}

// ---------- Oppskrifter ----------

export const RECIPE_SORT_KEYS = [
  "name", "category", "department", "hydration", "dough", "products", "status", "labeling", "updated",
] as const;
export type RecipeSortKey = (typeof RECIPE_SORT_KEYS)[number];
export type RecipeDeptFilter = "all" | "bakeri" | "konditori" | "none";
export type RecipeStatusFilter = "all" | "draft" | "active" | "archived";

export interface RecipeListState {
  q: string;
  status: RecipeStatusFilter;
  labeling: "all" | LabelingStatus;
  dept: RecipeDeptFilter;
  /** «all», «none» eller et kategorinavn. */
  category: string;
  sort: RecipeSortKey;
  dir: "asc" | "desc";
  page: number;
}

export const RECIPE_LIST_DEFAULTS: RecipeListState = {
  q: "", status: "all", labeling: "all", dept: "all", category: "all", sort: "name", dir: "asc", page: 1,
};

export function parseRecipeListParams(sp: URLSearchParams): RecipeListState {
  return {
    q: cleanText(sp.get("q")),
    status: oneOf(sp.get("status"), ["draft", "active", "archived"] as const) ?? "all",
    labeling: oneOf(sp.get("merking"), LABELING_VALUES) ?? "all",
    dept: oneOf(sp.get("avdeling"), ["bakeri", "konditori", "none"] as const) ?? "all",
    category: cleanText(sp.get("kategori")).slice(0, 100) || "all",
    sort: oneOf(sp.get("sort"), RECIPE_SORT_KEYS) ?? "name",
    dir: oneOf(sp.get("retning"), ["asc", "desc"] as const) ?? "asc",
    page: cleanPage(sp.get("side")),
  };
}

export function writeRecipeListParams(current: URLSearchParams, s: RecipeListState): URLSearchParams {
  const d = RECIPE_LIST_DEFAULTS;
  return writeManaged(current, [
    ["q", s.q.trim() ? s.q : "", ""],
    ["status", s.status, d.status],
    ["merking", s.labeling, d.labeling],
    ["avdeling", s.dept, d.dept],
    ["kategori", s.category, d.category],
    ["sort", s.sort, d.sort],
    ["retning", s.dir, d.dir],
    ["side", s.page, d.page],
  ]);
}

// ---------- Vareliste ----------

export type ProductStatusFilter = "all" | "active" | "paused" | "discontinued" | "draft";
export type ProductVariantFilter = "all" | "parents" | "variants";

export interface ProductListState {
  q: string;
  category: string;
  status: ProductStatusFilter;
  variant: ProductVariantFilter;
  labeling: "all" | LabelingStatus;
}

export const PRODUCT_LIST_DEFAULTS: ProductListState = {
  q: "", category: "all", status: "all", variant: "all", labeling: "all",
};

export function parseProductListParams(sp: URLSearchParams): ProductListState {
  return {
    q: cleanText(sp.get("q")),
    category: cleanText(sp.get("kategori")).slice(0, 100) || "all",
    status: oneOf(sp.get("status"), ["active", "paused", "discontinued", "draft"] as const) ?? "all",
    variant: oneOf(sp.get("variant"), ["parents", "variants"] as const) ?? "all",
    labeling: oneOf(sp.get("merking"), LABELING_VALUES) ?? "all",
  };
}

export function writeProductListParams(current: URLSearchParams, s: ProductListState): URLSearchParams {
  const d = PRODUCT_LIST_DEFAULTS;
  return writeManaged(current, [
    ["q", s.q.trim() ? s.q : "", ""],
    ["kategori", s.category, d.category],
    ["status", s.status, d.status],
    ["variant", s.variant, d.variant],
    ["merking", s.labeling, d.labeling],
  ]);
}
