import { supabase } from "@/integrations/supabase/client";
import type { ProductionPlanRow, ProduksjonsplanCriteria } from "../types";

export interface SnapshotItem {
  row_key: string;
  product_id: string;
  quantity_ordered: number;
  quantity_from_stock: number;
  quantity_to_produce: number;
  trays_full: number;
  trays_partial: number;
}

/**
 * Stabil rad-nøkkel som speiler aggregeringen i useProductionPlan.
 * Må brukes både ved lagring og ved oppslag/diff for å sammenligne riktig rad.
 */
export function buildRowKey(
  row: Pick<ProductionPlanRow, "product_id" | "production_group_id" | "main_category_id" | "tour_number">,
  criteria: ProduksjonsplanCriteria,
): string {
  const tourKey = criteria.sum_tours ? "ALL" : `t${row.tour_number ?? "x"}`;
  let aggKey: string;
  if (criteria.aggregation === "per_product") {
    aggKey = `p:${row.product_id}`;
  } else if (criteria.aggregation === "per_production_group") {
    aggKey = `pg:${row.production_group_id ?? `_${row.product_id}`}`;
  } else {
    aggKey = `mp:${row.main_category_id ?? "_"}::${row.production_group_id ?? `_${row.product_id}`}`;
  }
  return `${tourKey}::${aggKey}`;
}

/**
 * Sammenligner kun de kriterie-feltene som påvirker hvilke rader som dukker opp og hvordan de aggregeres.
 * Print-innstillinger (kopier, korreksjon) skal ikke gjøre snapshot ugyldig som sammenligningsgrunnlag.
 */
function criteriaSignature(c: ProduksjonsplanCriteria): string {
  return JSON.stringify({
    tour_numbers: [...c.tour_numbers].sort((a, b) => a - b),
    sum_tours: !!c.sum_tours,
    main_category_ids: [...c.main_category_ids].sort(),
    sub_category_ids: [...c.sub_category_ids].sort(),
    include_products_without_subcategory: !!c.include_products_without_subcategory,
    aggregation: c.aggregation,
    customer_group_ids: [...c.customer_group_ids].sort(),
  });
}

/**
 * Hent siste snapshot for gitt selskap + dato som matcher samme kriterier
 * (ellers gir korreksjonslisten feil sammenligning). Returnerer items mappet på row_key.
 */
export async function fetchLatestSnapshotItems(
  legalEntityId: string,
  productionDate: string,
  criteria: ProduksjonsplanCriteria,
): Promise<{ takenAt: string; items: Map<string, SnapshotItem> } | null> {
  const { data: snaps, error } = await supabase
    .from("production_plan_snapshots")
    .select("id, created_at, criteria_copy")
    .eq("legal_entity_id", legalEntityId)
    .eq("production_date", productionDate)
    .eq("list_type", "produksjonsliste")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error || !snaps || snaps.length === 0) return null;

  const wantedSig = criteriaSignature(criteria);
  const match = snaps.find(
    (s) => criteriaSignature((s.criteria_copy ?? {}) as unknown as ProduksjonsplanCriteria) === wantedSig,
  );
  if (!match) return null;

  const { data: items, error: itemsErr } = await supabase
    .from("production_plan_snapshot_items")
    .select("row_key, product_id, quantity_ordered, quantity_from_stock, quantity_to_produce, trays_full, trays_partial")
    .eq("snapshot_id", match.id);

  if (itemsErr || !items) return null;

  const map = new Map<string, SnapshotItem>();
  for (const it of items) {
    const key = it.row_key && it.row_key.length > 0 ? it.row_key : `legacy:${it.product_id}`;
    map.set(key, it as SnapshotItem);
  }
  return { takenAt: match.created_at, items: map };
}

/** Lagre nytt snapshot av planen. */
export async function saveProductionPlanSnapshot(
  legalEntityId: string,
  productionDate: string,
  criteria: ProduksjonsplanCriteria,
  rows: ProductionPlanRow[],
): Promise<{ id: string; itemCount: number } | null> {
  const { data: snap, error } = await supabase
    .from("production_plan_snapshots")
    .insert([{
      legal_entity_id: legalEntityId,
      production_date: productionDate,
      tours: criteria.tour_numbers,
      criteria_copy: criteria as never,
      list_type: "produksjonsliste",
    }])
    .select("id")
    .single();

  if (error || !snap) {
    console.error("Kunne ikke lagre snapshot", error);
    return null;
  }

  // Lag én snapshot-item per rad i utskriften, nøklet på row_key (samme aggregering som tabellen).
  const agg = new Map<string, SnapshotItem>();
  for (const r of rows) {
    const key = buildRowKey(r, criteria);
    const cur = agg.get(key);
    if (cur) {
      cur.quantity_ordered += r.quantity_ordered;
      cur.quantity_from_stock += r.quantity_from_stock;
      cur.quantity_to_produce += r.quantity_to_produce;
      cur.trays_full += r.trays_full;
      cur.trays_partial += r.trays_partial;
    } else {
      agg.set(key, {
        row_key: key,
        product_id: r.product_id,
        quantity_ordered: r.quantity_ordered,
        quantity_from_stock: r.quantity_from_stock,
        quantity_to_produce: r.quantity_to_produce,
        trays_full: r.trays_full,
        trays_partial: r.trays_partial,
      });
    }
  }

  const items = Array.from(agg.values()).map((it) => ({ ...it, snapshot_id: snap.id }));
  if (items.length > 0) {
    const { error: insErr } = await supabase
      .from("production_plan_snapshot_items")
      .insert(items);
    if (insErr) {
      console.error("Kunne ikke lagre snapshot items", insErr);
      await supabase.from("production_plan_snapshots").delete().eq("id", snap.id);
      return null;
    }
  }

  return { id: snap.id, itemCount: items.length };
}
