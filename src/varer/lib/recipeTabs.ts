/**
 * Fanene på oppskriftssiden (`/varer/oppskrifter/:id?tab=`).
 *
 * Fanen leses fra og skrives til `?tab=`. Standardfanen skrives ikke i URL-en,
 * slik at gamle lenker uten parameter fortsatt åpner Oppskrift. Ankrene
 * `seksjon-*` og `merking-*` peker på en fane, så en lenke eller et klikk i
 * «Gjenstår» kan bytte fane før fokus flyttes.
 */

export const RECIPE_TABS = [
  { id: "oppskrift", label: "Oppskrift" },
  { id: "fremgangsmate", label: "Fremgangsmåte" },
  { id: "varer", label: "Varer og lønnsomhet" },
  { id: "merking", label: "Merking" },
  { id: "historikk", label: "Historikk" },
] as const;

export type RecipeTabId = (typeof RECIPE_TABS)[number]["id"];

export const DEFAULT_RECIPE_TAB: RecipeTabId = "oppskrift";
export const RECIPE_TAB_PARAM = "tab";

const IDS = new Set<string>(RECIPE_TABS.map((t) => t.id));

export function isRecipeTab(value: unknown): value is RecipeTabId {
  return typeof value === "string" && IDS.has(value);
}

/** Fanen i URL-en. Ukjent eller manglende verdi gir standardfanen. */
export function recipeTabFrom(search: URLSearchParams | string): RecipeTabId {
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  const v = sp.get(RECIPE_TAB_PARAM);
  return isRecipeTab(v) ? v : DEFAULT_RECIPE_TAB;
}

/** Ny spørrestreng ved fanebytte. Andre parametre (f.eks. `fra`) bevares. */
export function recipeTabSearch(search: URLSearchParams | string, tab: RecipeTabId): string {
  const sp = new URLSearchParams(typeof search === "string" ? search : search.toString());
  if (tab === DEFAULT_RECIPE_TAB) sp.delete(RECIPE_TAB_PARAM);
  else sp.set(RECIPE_TAB_PARAM, tab);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Hvilken fane et anker (`seksjon-*`, `merking-*`, `etikett-*`, `vare-*`) ligger i. */
export function recipeTabForAnchor(anchor: string | null | undefined): RecipeTabId | null {
  if (!anchor) return null;
  const id = anchor.startsWith("#") ? anchor.slice(1) : anchor;
  switch (id) {
    case "seksjon-ingredienser":
    case "seksjon-info":
    case "oppskrift-advarsler":
      return "oppskrift";
    case "seksjon-prosess":
    case "seksjon-notater":
      return "fremgangsmate";
    case "seksjon-koblinger":
      return "varer";
    case "seksjon-historikk":
      return "historikk";
    default:
      break;
  }
  if (id.startsWith("merking-") || id.startsWith("etikett-")) return "merking";
  if (id.startsWith("vare-")) return "varer";
  return null;
}
