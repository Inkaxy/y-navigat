import { productionRowKey } from "../hooks/useProductionPlanSnapshots";
import { sortSources, type PlanSource } from "./planSource";
import type { ProductionPlanRow, ProductionPlanRowDetail } from "../types";

/** Produktfeltene aggregeringen trenger. */
export interface AggregateProduct {
  id: string;
  display_number: number | null;
  display_name: string;
  unit_of_sale: string | null;
  main_category_id: string | null;
  sub_category_id: string | null;
  production_group_id: string | null;
  dough_type: string | null;
  pieces_per_tray: number | null;
  pieces_per_liter: number | null;
}

/** Én planlinje før summering. */
export interface AggregateLine {
  tour: number | null;
  /** Produktet raden føres på (kan være produksjonsgruppens hovedvare). */
  product: AggregateProduct;
  /** Produktet linjen faktisk gjelder (brukes i detaljlista). */
  originalProduct: AggregateProduct;
  quantity: number;
  customerId: string | null;
  source: PlanSource;
}

/** Oppslag som beriker radene. Alle er valgfrie. */
export interface AggregateLookups {
  mainCategory?: (id: string) => { code: string; display_name: string } | null | undefined;
  productionGroup?: (id: string) => { display_name: string } | null | undefined;
  customer?: (
    id: string,
  ) => { number: string | null; name: string; address: string | null } | null | undefined;
  tourName?: (tour: number) => string | null | undefined;
}

/** Kriteriene som påvirker selve summeringen. */
export interface AggregateCriteria {
  sum_tours: boolean;
  aggregation?: string;
}

/**
 * Summerer planlinjer per rad-nøkkel (`productionRowKey`) — samme nøkkel som
 * snapshot/korreksjonslista, slik at diffen sammenligner samme rader.
 * Ren funksjon: ingen nettverkskall, testbar.
 */
export function aggregateProductionLines(
  lines: AggregateLine[],
  criteria: AggregateCriteria,
  lookups: AggregateLookups = {},
): ProductionPlanRow[] {
  const agg = new Map<string, ProductionPlanRow>();
  const sourcesByKey = new Map<string, Set<PlanSource>>();

  for (const { tour, product, originalProduct, quantity, customerId, source } of lines) {
    const k = productionRowKey(criteria.sum_tours ? null : tour, product.id, criteria);
    const sourceSet = sourcesByKey.get(k) ?? new Set<PlanSource>();
    sourceSet.add(source);
    sourcesByKey.set(k, sourceSet);

    let row = agg.get(k);
    if (!row) {
      const main = product.main_category_id
        ? lookups.mainCategory?.(product.main_category_id) ?? null
        : null;
      const pg = product.production_group_id
        ? lookups.productionGroup?.(product.production_group_id) ?? null
        : null;
      row = {
        product_id: product.id,
        product_code: product.display_number != null ? String(product.display_number) : null,
        product_name:
          criteria.aggregation === "per_production_group" && pg
            ? pg.display_name
            : product.display_name,
        unit_of_sale: product.unit_of_sale,
        main_category_id: product.main_category_id,
        main_category_code: main?.code ?? null,
        main_category_name: main?.display_name ?? null,
        sub_category_id: product.sub_category_id,
        production_group_id: product.production_group_id,
        production_group_name: pg?.display_name ?? null,
        dough_type: product.dough_type,
        pieces_per_tray: product.pieces_per_tray,
        pieces_per_liter: product.pieces_per_liter,
        quantity_ordered: 0,
        quantity_from_stock: 0,
        quantity_to_produce: 0,
        trays_full: 0,
        trays_partial: 0,
        liters: null,
        on_stock: null,
        tour_number: criteria.sum_tours ? null : tour,
        sources: [],
        details: [],
      };
      agg.set(k, row);
    }
    row.quantity_ordered += quantity;

    if (customerId) {
      const c = lookups.customer?.(customerId) ?? null;
      const detail: ProductionPlanRowDetail = {
        customer_id: customerId,
        customer_number: c?.number ?? null,
        customer_name: c?.name ?? "Ukjent kunde",
        address: c?.address ?? null,
        tour_number: tour,
        tour_name: tour != null ? lookups.tourName?.(tour) ?? null : null,
        product_id: originalProduct.id,
        product_code:
          originalProduct.display_number != null ? String(originalProduct.display_number) : null,
        quantity,
        unit_of_sale: originalProduct.unit_of_sale,
        source,
      };
      row.details.push(detail);
    }
  }

  for (const [k, row] of agg) {
    row.sources = sortSources(sourcesByKey.get(k) ?? []);
  }

  // Sorter detaljer per rad: tur, så kundenummer
  for (const row of agg.values()) {
    row.details.sort((a, b) => {
      const ta = a.tour_number ?? 999;
      const tb = b.tour_number ?? 999;
      if (ta !== tb) return ta - tb;
      const ca = a.customer_number ?? "";
      const cb = b.customer_number ?? "";
      return ca.localeCompare(cb, "nb", { numeric: true });
    });
  }

  return Array.from(agg.values());
}
