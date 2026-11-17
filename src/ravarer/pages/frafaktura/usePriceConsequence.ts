import { useMemo } from "react";
import { useProductMarginsMany } from "@/varer/hooks/useProductCalc";
import type { RecipeUsage } from "@/varer/hooks/usePrisgrunnlag";
import type { AddLineItem } from "@/varer/hooks/usePriceRounds";
import { marginFigures, neededPrice, productDrivers, type FactorChange } from "@/varer/lib/prisgrunnlag";
import { pickLevel } from "@/varer/lib/prisgrunnlagView";
import type { PriceJump } from "@/ravarer/lib/fraFaktura/priceJumps";

const MAX_PRODUCTS = 25;

/**
 * Konsekvens av et prishopp: hvor mange kalkyler varen brukes i, og hvor mange varer som faller under
 * marginmålet (Brutto eller DG2) hvis den nye prisen gjelder. Samme regnestykke som Prisgrunnlag.
 * `falling` er null mens noe lastes eller feiler (ukjent ≠ 0).
 */
export function usePriceConsequence(j: PriceJump, usage: readonly RecipeUsage[] | undefined, reason: string) {
  const recipes = useMemo(() => (usage ? usage.filter((u) => u.lines.some((l) => l.rawMaterialId === j.rawMaterialId)) : null), [usage, j.rawMaterialId]);
  const products = useMemo(() => {
    const seen = new Map<string, string>();
    for (const u of recipes ?? []) for (const p of u.products) if (!seen.has(p.id)) seen.set(p.id, u.recipeId);
    return [...seen.entries()].slice(0, MAX_PRODUCTS);
  }, [recipes]);
  const qs = useProductMarginsMany(products.map(([id]) => id));
  const change: FactorChange = { rawMaterialId: j.rawMaterialId, name: j.name, baseUnit: j.baseUnit ?? "", thenPrice: j.oldPrice, thenDate: "", nowPrice: j.newPrice, changePct: j.pct, firstInPeriod: false };
  const changes = new Map([[j.rawMaterialId, change]]);

  let falling: number | null = recipes ? 0 : null;
  const items: AddLineItem[] = [];
  products.forEach(([pid, recipeId], i) => {
    const m = qs[i]?.data;
    if (falling == null) return;
    if (!qs[i] || qs[i].isLoading || qs[i].isError) { falling = null; return; }
    const c = m?.cost;
    if (!m?.has_cost || !c) return;
    const parts = { raw: Number(c.raw_cost ?? 0), labor: Number(c.labor_cost ?? 0), energy: Number(c.energy_cost ?? 0), pack: Number(c.packaging_cost ?? 0) };
    const packIn = typeof m.packaging_in_margins === "boolean" ? m.packaging_in_margins : true;
    const lines = (recipes ?? []).find((u) => u.recipeId === (c.recipe_id ?? recipeId))?.lines ?? [];
    const delta = productDrivers(lines, changes, c.units_per_batch ?? null).drivers.reduce((s, d) => s + d.deltaPerUnit, 0);
    const level = pickLevel(m.levels ?? [], null);
    if (!level || level.price == null) return;
    const after = { ...parts, raw: parts.raw + delta };
    const now = marginFigures(level.price, parts, packIn);
    const next = marginFigures(level.price, after, packIn);
    const tb = level.target_brutto_pct, td = level.target_dg2_pct;
    const drops = (tb != null && now.bruttoPct != null && next.bruttoPct != null && now.bruttoPct >= tb && next.bruttoPct < tb)
      || (td != null && now.dg2Pct != null && next.dg2Pct != null && now.dg2Pct >= td && next.dg2Pct < td);
    if (!drops) return;
    falling = (falling ?? 0) + 1;
    const need = neededPrice(after, packIn, tb, td);
    if (need != null) items.push({ product_id: pid, price_list_id: level.price_list_id, new_price: need, reason });
  });
  return { recipes: recipes?.length ?? null, falling, items, truncated: (recipes ? new Set(recipes.flatMap((u) => u.products.map((p) => p.id))).size : 0) > MAX_PRODUCTS };
}
