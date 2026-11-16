// Setter sammen kalkylen (product_margins) med prisendringene for én vare. Ren logikk.
import type { MarginLevel, ProductMargins } from "@/varer/hooks/useProductCalc";
import {
  marginFigures, neededPrice, productDrivers,
  type CostParts, type Driver, type FactorChange, type MarginFigures, type UsageLine,
} from "./prisgrunnlag";

export interface ProductView {
  productId: string;
  name: string;
  hasCost: boolean;
  recipeId: string | null;
  unitsPerBatch: number | null;
  levels: MarginLevel[];
  level: MarginLevel | null;
  parts: CostParts | null;
  /** Om emballasje teller i Brutto/DG2. Fra databasen når innstillingen finnes, ellers standard (på). */
  packIn: boolean;
  packInFromServer: boolean;
  drivers: Driver[];
  unknownLines: number;
  deltaPerUnit: number;
  now: MarginFigures | null;
  then: MarginFigures | null;
  needed: number | null;
}

/** Prisnivået som vises først: valgt liste, ellers første engros med pris, ellers første med pris. */
export function pickLevel(levels: readonly MarginLevel[], wanted: string | null): MarginLevel | null {
  return levels.find((l) => l.price_list_id === wanted)
    ?? levels.find((l) => l.price_level === "engros" && l.price != null)
    ?? levels.find((l) => l.price != null) ?? levels[0] ?? null;
}

export function buildProductView(input: {
  productId: string; name: string; margins: ProductMargins | undefined; wantedLevel: string | null;
  usageLines: readonly UsageLine[]; changes: ReadonlyMap<string, FactorChange>;
}): ProductView {
  const m = input.margins;
  const c = m?.cost;
  const levels = m?.levels ?? [];
  const level = pickLevel(levels, input.wantedLevel);
  const packInFromServer = typeof m?.packaging_in_margins === "boolean";
  const packIn = packInFromServer ? m!.packaging_in_margins! : true;
  const units = c?.units_per_batch ?? null;
  const parts: CostParts | null = m?.has_cost && c ? {
    raw: Number(c.raw_cost ?? 0), labor: Number(c.labor_cost ?? 0), energy: Number(c.energy_cost ?? 0), pack: Number(c.packaging_cost ?? 0),
  } : null;
  const { drivers, unknownLines } = productDrivers(input.usageLines, input.changes, units);
  const delta = drivers.reduce((s, d) => s + d.deltaPerUnit, 0);
  const price = level?.price ?? null;
  return {
    productId: input.productId, name: input.name, hasCost: !!parts, recipeId: c?.recipe_id ?? null, unitsPerBatch: units,
    levels, level, parts, packIn, packInFromServer, drivers, unknownLines, deltaPerUnit: delta,
    now: parts ? marginFigures(price, parts, packIn) : null,
    then: parts ? marginFigures(price, { ...parts, raw: Math.max(0, parts.raw - delta) }, packIn) : null,
    needed: parts ? neededPrice(parts, packIn, level?.target_brutto_pct ?? null, level?.target_dg2_pct ?? null) : null,
  };
}
