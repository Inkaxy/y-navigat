import { useState } from "react";
import { RecipeTabBar } from "@/varer/components/recipes/detail/RecipeTabBar";
import { RecipeKeyFigures } from "@/varer/components/recipes/detail/RecipeKeyFigures";
import { RecipeRemainingPanel } from "@/varer/components/recipes/detail/RecipeRemainingPanel";
import { RecipeProductsTab } from "@/varer/components/recipes/detail/RecipeProductsTab";
import type { ProfitRow } from "@/varer/components/recipes/detail/ProfitTable";
import { useMatchMedia } from "@/varer/hooks/useIsDesktop";
import type { RecipeProductLinkRow } from "@/varer/hooks/useRecipeProductLinks";
import type { MarginLevel, ProductMargins } from "@/varer/hooks/useProductCalc";
import { composeRemaining, costItem, labelItems, marginItems, warningItems } from "@/varer/lib/recipeRemaining";
import type { RecipeWarning } from "@/varer/hooks/useRecipeWarnings";
import type { RecipeTabId } from "@/varer/lib/recipeTabs";
import { salesUnitWeight } from "@/varer/lib/salesUnitPrice";
import type { BakersTotals } from "@/varer/lib/bakers";
import type { RecipeCostTotals } from "@/varer/lib/recipeCost";

/**
 * Syntetisk, nettverksfri forhåndsvisning av oppskriftssidens fanelinje,
 * sidepanel og fanen «Varer og lønnsomhet». Ingenting lagres; tallene er
 * eksempeldata, ikke beregnet her.
 */
const lvl = (o: Partial<MarginLevel>): MarginLevel => ({
  price_list_id: "x", code: null, name: null, price_level: "utsalg", is_provisional: false, price: null,
  price_with_packaging: null, brutto_pct: null, db2: null, dg2_pct: null, target_brutto_pct: 70, target_dg2_pct: 35,
  target_source: "kategori", avvik_pp: null, needed_price: null, needed_change_pct: null, status: "ingen_pris", ...o,
});

const product = (id: string, name: string, no: number, weight: number | null) => ({
  id, display_name: name, display_number: no, status: "active", unit_of_sale: "stk", weight_per_unit_grams: weight, calc_type: "oppskrift",
});

const LINKS: RecipeProductLinkRow[] = [
  { id: "l1", product_id: "p1", is_primary: true, declaration_mode: null, extra_lines: [], sales_unit_basis: null, units_per_sales_unit: null, sales_unit_weight_g: 750, units_per_batch_override: null, products: product("p1", "Grovbrød med solsikke", 1012, 750) },
  { id: "l2", product_id: "p2", is_primary: false, declaration_mode: "manual", extra_lines: [1], sales_unit_basis: null, units_per_sales_unit: null, sales_unit_weight_g: null, units_per_batch_override: null, products: product("p2", "Grovbrød skivet", 1013, null) },
  { id: "l3", product_id: "p3", is_primary: false, declaration_mode: null, extra_lines: [], sales_unit_basis: null, units_per_sales_unit: null, sales_unit_weight_g: null, units_per_batch_override: null, products: product("p3", "Grovbrød halv", 1014, 375) },
];

const M1: ProductMargins = {
  has_cost: true, calc_type: "oppskrift",
  cost: { raw_cost: 9.42, labor_cost: 11.8, energy_cost: 1.6, packaging_cost: 0.9, cost_price: 22.82, units_per_batch: 48, quality: "A", notes: [] },
  levels: [
    lvl({ price_list_id: "i1", price_level: "internpris", name: "Intern", price: 28, brutto_pct: 66.36, db2: 5.18, dg2_pct: 18.5, avvik_pp: -16.5, needed_price: 35.11, needed_change_pct: 25.4, status: "rod" }),
    lvl({ price_list_id: "e1", price_level: "engros", name: "Engros", price: 39, brutto_pct: 75.85, db2: 16.18, dg2_pct: 41.49, avvik_pp: 5.85, needed_price: 35.11, needed_change_pct: -10, status: "gronn" }),
    lvl({ price_list_id: "u1", price_level: "utsalg", name: "Butikk", price: 59, brutto_pct: 84.03, db2: 36.18, dg2_pct: 61.32, avvik_pp: 14.03, needed_price: 35.11, needed_change_pct: -40.5, status: "gronn" }),
  ],
};
const M2: ProductMargins = { ...M1, levels: [lvl({ price_list_id: "u2", price_level: "utsalg", name: "Butikk", price: 64, brutto_pct: 85.28, db2: 41.18, dg2_pct: 64.34, status: "gronn" }), lvl({ price_list_id: "e2", price_level: "engros", name: "Engros", status: "ingen_pris" })] };
const M3: ProductMargins = { has_cost: false, calc_type: "oppskrift", cost: { notes: ["Vekt per salgsenhet mangler på koblingen", "«Solsikkekjerner» mangler verifisert kostpris"] }, levels: [] };

const TOTALS = { totalFlourG: 10000, totalDoughG: 36200, unitCount: 48, doughPerUnitG: 754, incomplete: false, warnings: [], hydrationPct: 78, saltPct: 2, leavenPct: 20 } as unknown as BakersTotals;
const COST = { totalCost: 452.16, costPerKg: 12.49, costPerUnit: 9.42, incomplete: true, unverifiedCount: 0, missing: [{ name: "Solsikkekjerner", reason: "mangler verifisert kostpris" }], newestVerifiedDate: null } as unknown as RecipeCostTotals;

export default function RecipeOverviewPreview() {
  const [tab, setTab] = useState<RecipeTabId>("varer");
  const wide = useMatchMedia("(min-width: 1280px)");
  const rows: ProfitRow[] = [
    { link: LINKS[0], state: "ready", margins: M1, retry: () => undefined },
    { link: LINKS[1], state: "ready", margins: M2, retry: () => undefined },
    { link: LINKS[2], state: "ready", margins: M3, retry: () => undefined },
  ];
  const summary = composeRemaining([
    warningItems([{ kind: "missing_allergens", message: "«Solsikkekjerner» mangler allergeninformasjon", lineId: "x", rawMaterialId: "rm", name: "Solsikkekjerner", action: { label: "Åpne råvare", href: "/forhandsvisning/oppskrift" } } satisfies RecipeWarning], "p1"),
    [costItem(COST)!],
    labelItems({ checklist: [{ key: "storage", label: "Oppbevaring", level: "warn", detail: "Oppbevaring mangler." }], blockReasons: [], declarationManual: false }),
    marginItems(rows.map((r) => ({ productId: r.link.product_id, name: r.link.products?.display_name ?? "", data: r.margins! }))),
  ]);
  return (
    <main className="space-y-4 px-page py-5">
      <p className="text-caption text-muted-foreground">Syntetisk forhåndsvisning – ingen data lagres.</p>
      <h1 className="font-display text-xl font-semibold">Grovbrød med solsikke</h1>
      <RecipeTabBar active={tab} onChange={setTab} indicators={{ oppskrift: { must: summary.byTab.oppskrift?.must ?? 0, should: summary.byTab.oppskrift?.should ?? 0, known: true }, varer: { must: 0, should: summary.byTab.varer?.should ?? 0, known: true }, merking: { must: 0, should: 1, known: true } }} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <aside aria-label="Nøkkeltall og gjenstår" className="space-y-4 xl:sticky xl:top-4 xl:col-start-2 xl:row-start-1 xl:self-start">
          <RecipeKeyFigures totals={TOTALS} cost={COST} isScaled={false} primary={{ name: "Grovbrød med solsikke", state: "ready", margins: M1, weight: salesUnitWeight(LINKS[0], LINKS[0].products) }} />
          <RecipeRemainingPanel summary={summary} sources={[{ key: "a", label: "råvaredata", state: "ready" }]} collapsible={!wide} onSelect={(i) => setTab(i.tab)} />
        </aside>
        <div className="min-w-0 xl:col-start-1 xl:row-start-1">
          {tab === "varer" ? (
            <RecipeProductsTab
              links={{ rows: LINKS, isLoading: false, isError: false, error: null, retry: () => undefined }}
              rows={rows}
              primary={{ name: "Grovbrød med solsikke", state: "ready", margins: M1 }}
              cost={COST}
              currentProductId={null}
              canWrite
              picker={{ products: [{ id: "p9", display_name: "Grovbrød stor", display_number: 1020 }], isLoading: false, isError: false }}
              onAdd={async () => false}
              onRemove={() => undefined}
              busy={false}
            />
          ) : (
            <p className="text-body text-muted-foreground">Denne fanen viser eksisterende innhold i den innloggede appen.</p>
          )}
        </div>
      </div>
    </main>
  );
}
