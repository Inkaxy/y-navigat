import type { RecipeWarning, RecipeWarningKind } from "@/varer/hooks/useRecipeWarnings";

export interface RecipeWarningGroup {
  /** Stabil nøkkel: linje-id, ellers «oppskrift». */
  key: string;
  lineId: string | null;
  rawMaterialId: string | null;
  /** Ingrediensnavn, eller null for advarsler som gjelder hele oppskriften. */
  name: string | null;
  items: RecipeWarning[];
}

export interface RecipeWarningSummary {
  groups: RecipeWarningGroup[];
  /** Antall unike problemer etter deduplisering. */
  problemCount: number;
  /** Antall ingredienslinjer med minst ett problem. */
  affectedLineCount: number;
  /** Antall problemer per type, for oversikten. */
  byKind: Partial<Record<RecipeWarningKind, number>>;
}

const RECIPE_KEY = "oppskrift";

/**
 * Grupperer advarslene per ingredienslinje. To advarsler slås bare sammen når
 * de gjelder samme linje, samme type, samme tekst og samme mål — to linjer med
 * likt navn forblir to grupper. Rekkefølgen følger linjenes rekkefølge.
 */
export function groupRecipeWarnings(warnings: RecipeWarning[]): RecipeWarningSummary {
  const groups = new Map<string, RecipeWarningGroup>();
  const seen = new Set<string>();
  const byKind: Partial<Record<RecipeWarningKind, number>> = {};

  for (const w of warnings) {
    const key = w.lineId ?? RECIPE_KEY;
    const identity = [key, w.kind, w.message, w.action?.href ?? ""].join("\u0000");
    if (seen.has(identity)) continue;
    seen.add(identity);

    let g = groups.get(key);
    if (!g) {
      g = { key, lineId: w.lineId, rawMaterialId: w.rawMaterialId, name: w.lineId ? w.name : null, items: [] };
      groups.set(key, g);
    }
    g.items.push(w);
    byKind[w.kind] = (byKind[w.kind] ?? 0) + 1;
  }

  // Oppskriftsnivå (f.eks. dekningsgrad) vises sist.
  const ordered = [...groups.values()].sort((a, b) => Number(a.lineId === null) - Number(b.lineId === null));
  return {
    groups: ordered,
    problemCount: seen.size,
    affectedLineCount: ordered.filter((g) => g.lineId !== null).length,
    byKind,
  };
}

/** Lenker samlet per mål, slik at én råvare med tre mangler gir én «Åpne»-lenke per fane. */
export function distinctActions(items: RecipeWarning[]): { label: string; href: string }[] {
  const out = new Map<string, { label: string; href: string }>();
  for (const w of items) if (w.action && !out.has(w.action.href)) out.set(w.action.href, w.action);
  return [...out.values()];
}

/**
 * Flytter fokus til ingrediensfeltet for en linje. Faller tilbake til raden
 * når feltet er låst (f.eks. under skalering). Returnerer om linjen ble funnet.
 */
export function focusRecipeLine(lineId: string, root: ParentNode = document): boolean {
  const row = root.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(lineId)}"]`);
  if (!row) return false;
  const field = row.querySelector<HTMLElement>(
    `[data-grid-cell$=":name"] input:not([disabled]), [data-grid-cell$=":name"] button:not([disabled])`,
  );
  const target = field ?? row;
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  target.focus({ preventScroll: true });
  return true;
}
