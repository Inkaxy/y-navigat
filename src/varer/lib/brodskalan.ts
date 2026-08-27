/**
 * Brødskala'n — offisielle merker fra Baker- og Konditorbransjens Landsforening (BKLF).
 *
 * Selve grovhetsberegningen ligger i `_shared/declaration-core.ts` og lagres av
 * `compute-recipe-label` i `recipe_label_calculated.grain_category`. Her kobler vi
 * kun kategori → offisielt merke. Merket skal aldri vises på gjetning.
 */
import ekstraGrovtSrc from "@/assets/brodskalan/brodskalan-ekstra_grovt.png";
import fintSrc from "@/assets/brodskalan/brodskalan-fint.png";
import grovtSrc from "@/assets/brodskalan/brodskalan-grovt.png";
import halvgrovtSrc from "@/assets/brodskalan/brodskalan-halvgrovt.png";

export type GrainCategory = "fint" | "halvgrovt" | "grovt" | "ekstra_grovt";

export interface BrodskalanMarkInfo {
  category: GrainCategory;
  src: string;
  label: string;
  rangeText: string;
  alt: string;
}

const BASE: Record<GrainCategory, { src: string; label: string; rangeText: string }> = {
  fint: { src: fintSrc, label: "Fint", rangeText: "0–25 %" },
  halvgrovt: { src: halvgrovtSrc, label: "Halvgrovt", rangeText: "26–50 %" },
  grovt: { src: grovtSrc, label: "Grovt", rangeText: "51–75 %" },
  ekstra_grovt: { src: ekstraGrovtSrc, label: "Ekstra grovt", rangeText: "76–100 %" },
};

export const BRODSKALAN_MARKS: Record<GrainCategory, BrodskalanMarkInfo> = Object.fromEntries(
  (Object.keys(BASE) as GrainCategory[]).map((key) => [
    key,
    {
      category: key,
      ...BASE[key],
      alt: `Brødskala'n: ${BASE[key].label}, ${BASE[key].rangeText} grovhet`,
    },
  ]),
) as Record<GrainCategory, BrodskalanMarkInfo>;

/** Returnerer merket for en kategori — null for ukjent/manglende verdi. */
export function brodskalanFor(category: string | null | undefined): BrodskalanMarkInfo | null {
  if (!category) return null;
  return BRODSKALAN_MARKS[category as GrainCategory] ?? null;
}

/** Kobler `products.breadscale_value` (1–4) til grovhetskategori. */
export function grainCategoryFromBreadscaleValue(value: unknown): GrainCategory | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const map: Record<number, GrainCategory> = {
    1: "fint",
    2: "halvgrovt",
    3: "grovt",
    4: "ekstra_grovt",
  };
  return map[n] ?? null;
}

/** True når beregningen har en advarsel om uklassifiserte kornråvarer. */
export function hasBrodskalanWarning(warnings: string[] | null | undefined): boolean {
  return (warnings ?? []).some((w) => w.toLowerCase().startsWith("brødskala"));
}
