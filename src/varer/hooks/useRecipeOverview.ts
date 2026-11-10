import { useMemo } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { useProductMarginsMany, type ProductMargins } from "@/varer/hooks/useProductCalc";
import { useRecipeLabelIssues } from "@/varer/hooks/useRecipeLabelIssues";
import type { RecipeWarningsResult } from "@/varer/hooks/useRecipeWarnings";
import type { RecipeProductLinkRow } from "@/varer/hooks/useRecipeProductLinks";
import type { LabelRecipe } from "@/varer/components/recipes/label/LabelTab";
import type { RemainingSource } from "@/varer/components/recipes/detail/RecipeRemainingPanel";
import type { ProfitRow } from "@/varer/components/recipes/detail/ProfitTable";
import type { TabIndicator } from "@/varer/components/recipes/detail/RecipeTabBar";
import type { BakersTotals } from "@/varer/lib/bakers";
import type { RecipeCostTotals } from "@/varer/lib/recipeCost";
import type { RecipeTabId } from "@/varer/lib/recipeTabs";
import {
  composeRemaining,
  costItem,
  labelItems,
  marginItems,
  totalsItem,
  warningItems,
  type RemainingSummary,
} from "@/varer/lib/recipeRemaining";

type State = "loading" | "error" | "ready";

/** Primærvaren først, deretter alfabetisk. */
export function orderLinks(rows: RecipeProductLinkRow[]): RecipeProductLinkRow[] {
  return [...rows].sort((a, b) => {
    if (!!a.is_primary !== !!b.is_primary) return a.is_primary ? -1 : 1;
    return (a.products?.display_name ?? "").localeCompare(b.products?.display_name ?? "", "nb-NO");
  });
}

/**
 * Samler sidepanelet og fanen «Varer og lønnsomhet»: «Gjenstår», fanemerker
 * og én `product_margins`-spørring per koblet vare. Leser bare eksisterende
 * resultater; ingen ny beregning og ingen skriving.
 */
export function useRecipeOverview(input: {
  recipeId: string | undefined;
  recipeName: string;
  recipe: LabelRecipe | null | undefined;
  legalEntityId: string | null | undefined;
  warnings: RecipeWarningsResult;
  cost: RecipeCostTotals;
  totals: BakersTotals;
  links: UseQueryResult<RecipeProductLinkRow[]>;
}): {
  summary: RemainingSummary;
  sources: RemainingSource[];
  indicators: Partial<Record<RecipeTabId, TabIndicator>>;
  orderedLinks: RecipeProductLinkRow[];
  profitRows: ProfitRow[];
} {
  const orderedLinks = useMemo(() => orderLinks(input.links.data ?? []), [input.links.data]);
  const productIds = useMemo(() => orderedLinks.map((l) => l.product_id), [orderedLinks]);
  const marginQueries = useProductMarginsMany(productIds);
  const label = useRecipeLabelIssues({
    recipeId: input.recipeId,
    recipeName: input.recipeName,
    recipe: input.recipe,
    legalEntityId: input.legalEntityId,
  });

  const profitRows: ProfitRow[] = orderedLinks.map((link, i) => {
    const q = marginQueries[i];
    const state: State = q?.isError ? "error" : q?.isLoading || !q ? "loading" : "ready";
    return { link, state, margins: q?.data as ProductMargins | undefined, retry: () => void q?.refetch() };
  });

  const warningsState: State = input.warnings.isError ? "error" : input.warnings.isLoading ? "loading" : "ready";
  const linksState: State = input.links.isError ? "error" : input.links.isLoading ? "loading" : "ready";
  const marginsState: State = profitRows.some((r) => r.state === "error")
    ? "error"
    : profitRows.some((r) => r.state === "loading")
      ? "loading"
      : "ready";

  const primaryId = orderedLinks[0]?.product_id ?? null;
  const readyMargins = profitRows
    .filter((r) => r.state === "ready" && r.margins)
    .map((r) => ({ productId: r.link.product_id, name: r.link.products?.display_name ?? "Uten navn", data: r.margins as ProductMargins }));

  const summary = composeRemaining([
    warningsState === "ready" ? warningItems(input.warnings.warnings, primaryId) : [],
    [totalsItem(input.totals), costItem(input.cost)].filter((x): x is NonNullable<typeof x> => x != null),
    label.state === "ready"
      ? labelItems({ checklist: label.checklist, blockReasons: label.blockReasons, declarationManual: label.declarationManual })
      : [],
    marginItems(readyMargins),
  ]);

  const sources: RemainingSource[] = [
    { key: "varsler", label: "råvaredata", state: warningsState, retry: input.warnings.refetch },
    { key: "merking", label: "merkedata", state: label.state, retry: label.retry },
    { key: "koblinger", label: "koblede varer", state: linksState, retry: () => void input.links.refetch() },
    {
      key: "kalkyler",
      label: "kalkyler",
      state: linksState === "ready" ? marginsState : linksState,
      retry: () => profitRows.filter((r) => r.state === "error").forEach((r) => r.retry()),
    },
  ];

  const count = (tab: RecipeTabId, known: boolean): TabIndicator => ({
    must: summary.byTab[tab]?.must ?? 0,
    should: summary.byTab[tab]?.should ?? 0,
    known,
  });
  const indicators: Partial<Record<RecipeTabId, TabIndicator>> = {
    oppskrift: count("oppskrift", warningsState === "ready" && label.state === "ready"),
    varer: count("varer", warningsState === "ready" && linksState === "ready" && marginsState === "ready"),
    merking: count("merking", label.state === "ready"),
  };

  return { summary, sources, indicators, orderedLinks, profitRows };
}
