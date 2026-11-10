/**
 * «Gjenstår» på oppskriftssiden: én samlet liste over det som må rettes før
 * godkjenning og det som bør sjekkes. Funksjonene her er rene og bygger bare
 * om resultater som allerede finnes (oppskriftsvarsler, kostgrunnlag,
 * etikettkontroll og `product_margins`). Ingenting regnes på nytt her.
 */
import type { RecipeWarning, RecipeWarningKind } from "@/varer/hooks/useRecipeWarnings";
import type { ChecklistItem } from "@/varer/lib/labelChecklist";
import type { MarginLevel, ProductMargins } from "@/varer/hooks/useProductCalc";
import { PRICE_LEVEL_LABEL, type PriceLevel } from "@/varer/hooks/useProductCalc";
import { groupRecipeWarnings } from "@/varer/lib/recipeWarningGroups";
import { nKr } from "@/varer/lib/calcFormat";
import type { RecipeTabId } from "@/varer/lib/recipeTabs";

export type RemainingSeverity = "must" | "should";

export type RemainingTarget =
  | { kind: "line"; lineId: string }
  | { kind: "anchor"; id: string }
  /** Nøkkel fra etikettkontrollen, eller «datakvalitet». */
  | { kind: "label"; key: string }
  | { kind: "product"; productId: string };

export interface RemainingItem {
  id: string;
  severity: RemainingSeverity;
  tab: RecipeTabId;
  title: string;
  details: string[];
  target: RemainingTarget | null;
  /** Ekstra lenke til stedet feilen rettes (f.eks. råvarekortet). */
  action: { label: string; href: string } | null;
}

/**
 * Oppskriftsvarsler som påvirker deklarasjon, næring eller produksjonsvekt
 * sperrer godkjenning. Pakning, kost og dekningsgrad er anbefalinger.
 */
const MUST_KINDS: ReadonlySet<RecipeWarningKind> = new Set<RecipeWarningKind>([
  "missing_nutrition",
  "missing_allergens",
  "missing_unit_weight",
  "zero_quantity",
  "free_text_line",
  "unknown_conversion",
]);

export function severityForWarning(kind: RecipeWarningKind): RemainingSeverity {
  return MUST_KINDS.has(kind) ? "must" : "should";
}

/** Live-varslene fra `useRecipeWarnings`, uten duplikater. */
export function warningItems(warnings: RecipeWarning[], primaryProductId: string | null = null): RemainingItem[] {
  const out: RemainingItem[] = [];
  for (const g of groupRecipeWarnings(warnings).groups) {
    g.items.forEach((w, i) => {
      const isMargin = w.kind === "low_margin";
      out.push({
        id: `varsel:${g.key}:${w.kind}:${i}`,
        severity: severityForWarning(w.kind),
        tab: isMargin ? "varer" : "oppskrift",
        title: w.message,
        details: [],
        target: w.lineId
          ? { kind: "line", lineId: w.lineId }
          : isMargin && primaryProductId
            ? { kind: "product", productId: primaryProductId }
            : { kind: "anchor", id: "seksjon-ingredienser" },
        action: w.action,
      });
    });
  }
  return out;
}

/** Kostvarselet som før sto i statslinjen. */
export function costItem(cost: { incomplete: boolean; missing: { name: string; reason: string }[] } | null | undefined): RemainingItem | null {
  if (!cost?.incomplete) return null;
  const n = cost.missing.length;
  return {
    id: "kost:ufullstendig",
    severity: "should",
    tab: "oppskrift",
    title: `Kostnaden er ufullstendig — ${n} linje${n === 1 ? "" : "r"} mangler grunnlag`,
    details: cost.missing.map((m) => `${m.name}: ${m.reason}`),
    target: { kind: "anchor", id: "seksjon-ingredienser" },
    action: null,
  };
}

/** Deigvekt som ikke kan brukes som produksjonsvekt. */
export function totalsItem(totals: { incomplete: boolean; warnings: string[] } | null | undefined): RemainingItem | null {
  if (!totals?.incomplete) return null;
  return {
    id: "vekt:ufullstendig",
    severity: "must",
    tab: "oppskrift",
    title: "Deigvekten er ufullstendig og kan ikke brukes som produksjonsvekt",
    details: totals.warnings,
    target: { kind: "anchor", id: "seksjon-ingredienser" },
    action: null,
  };
}

/**
 * Etikettkontrollen (`buildLabelChecklist`) og sperrene i beregningen
 * (`missing_data.block_reasons`). Røde punkter sperrer, gule er anbefalinger.
 * Sperrene i beregningen gjelder bare beregnet deklarasjon.
 */
export function labelItems(input: {
  checklist: ChecklistItem[];
  blockReasons: string[] | null | undefined;
  declarationManual: boolean;
}): RemainingItem[] {
  const out: RemainingItem[] = [];
  const seen = new Set<string>();
  for (const reason of input.blockReasons ?? []) {
    const text = reason.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({
      id: `merking:sperre:${out.length}`,
      severity: input.declarationManual ? "should" : "must",
      tab: "merking",
      title: text,
      details: input.declarationManual ? ["Gjelder beregnet deklarasjon. Gjeldende kilde er manuell."] : [],
      target: { kind: "label", key: "datakvalitet" },
      action: null,
    });
  }
  for (const item of input.checklist) {
    if (item.level === "ok") continue;
    const nameField = item.key === "name";
    out.push({
      id: `merking:${item.key}`,
      severity: item.level === "error" ? "must" : "should",
      tab: nameField ? "oppskrift" : "merking",
      title: item.label,
      details: [item.detail],
      target: nameField ? { kind: "anchor", id: "seksjon-info" } : { kind: "label", key: item.key },
      action: null,
    });
  }
  return out;
}

export interface LinkedProductMargins {
  productId: string;
  name: string;
  data: ProductMargins;
}

function levelName(level: MarginLevel, sameLevelCount: number): string {
  const base = PRICE_LEVEL_LABEL[level.price_level as PriceLevel] ?? level.name ?? level.price_level;
  return sameLevelCount > 1 && level.name ? `${base} (${level.name})` : base;
}

/**
 * Lønnsomhet fra `product_margins`: manglende kalkyle, prisnivå med status
 * `rod` og prisnivå uten pris. Halvfabrikat har ingen salgspris og hoppes over.
 */
export function marginItems(products: LinkedProductMargins[]): RemainingItem[] {
  const out: RemainingItem[] = [];
  for (const p of products) {
    const target: RemainingTarget = { kind: "product", productId: p.productId };
    if (!p.data.has_cost) {
      const notes = (p.data.cost?.notes ?? []).filter((n) => n.trim().length > 0);
      out.push({
        id: `lonnsomhet:${p.productId}:kost`,
        severity: "should",
        tab: "varer",
        title: `${p.name}: mangler kalkyle`,
        details: notes.length > 0 ? notes : ["Kalkylen har ikke fullstendig grunnlag."],
        target,
        action: null,
      });
      continue;
    }
    const halvfabrikat = p.data.calc_type === "halvfabrikat" || p.data.cost?.calc_type === "halvfabrikat";
    const levels = p.data.levels ?? [];
    for (const level of levels) {
      const same = levels.filter((l) => l.price_level === level.price_level).length;
      const name = levelName(level, same);
      if (level.status === "rod") {
        out.push({
          id: `lonnsomhet:${p.productId}:${level.price_list_id}:rod`,
          severity: "should",
          tab: "varer",
          title: `${p.name}: svak margin på ${name.toLocaleLowerCase("nb-NO")}`,
          details: level.needed_price != null ? [`Pris som trengs: ${nKr(level.needed_price)}`] : [],
          target,
          action: null,
        });
      } else if (level.status === "ingen_pris" && !halvfabrikat) {
        out.push({
          id: `lonnsomhet:${p.productId}:${level.price_list_id}:pris`,
          severity: "should",
          tab: "varer",
          title: `${p.name}: mangler ${name.toLocaleLowerCase("nb-NO")}`,
          details: level.needed_price != null ? [`Pris som trengs for å nå målet: ${nKr(level.needed_price)}`] : [],
          target,
          action: null,
        });
      }
    }
  }
  return out;
}

export interface RemainingSummary {
  must: RemainingItem[];
  should: RemainingItem[];
  byTab: Partial<Record<RecipeTabId, { must: number; should: number }>>;
}

/**
 * Setter sammen listen. Sperrende punkter kommer først. Varselet om lav
 * dekningsgrad utelates når samme vare allerede er meldt under mål.
 */
export function composeRemaining(groups: RemainingItem[][]): RemainingSummary {
  const all = groups.flat();
  const marginTargets = new Set(
    all.filter((i) => i.id.startsWith("lonnsomhet:") && i.id.endsWith(":rod") && i.target?.kind === "product")
      .map((i) => (i.target as { productId: string }).productId),
  );
  const kept = all.filter(
    (i) => !(i.id.includes(":low_margin:") && i.target?.kind === "product" && marginTargets.has(i.target.productId)),
  );
  const byTab: RemainingSummary["byTab"] = {};
  for (const i of kept) {
    const t = (byTab[i.tab] ??= { must: 0, should: 0 });
    t[i.severity] += 1;
  }
  return {
    must: kept.filter((i) => i.severity === "must"),
    should: kept.filter((i) => i.severity === "should"),
    byTab,
  };
}
