import { supabase } from "@/integrations/supabase/client";
import type { ProductionPlanRow, ProduksjonsplanCriteria } from "../types";

export interface SnapshotItem {
  product_id: string;
  quantity_ordered: number;
  quantity_from_stock: number;
  quantity_to_produce: number;
  trays_full: number;
  trays_partial: number;
}

/** Hent siste snapshot for gitt selskap + dato. Returnerer items mappet på product_id. */
export async function fetchLatestSnapshotItems(
  legalEntityId: string,
  productionDate: string,
): Promise<{ takenAt: string; items: Map<string, SnapshotItem> } | null> {
  const { data: snap, error } = await supabase
    .from("production_plan_snapshots")
    .select("id, created_at")
    .eq("legal_entity_id", legalEntityId)
    .eq("production_date", productionDate)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !snap) return null;

  const { data: items, error: itemsErr } = await supabase
    .from("production_plan_snapshot_items")
    .select("product_id, quantity_ordered, quantity_from_stock, quantity_to_produce, trays_full, trays_partial")
    .eq("snapshot_id", snap.id);

  if (itemsErr || !items) return null;

  const map = new Map<string, SnapshotItem>();
  for (const it of items) map.set(it.product_id, it as SnapshotItem);
  return { takenAt: snap.created_at, items: map };
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

  // Aggreger pr product_id (samme produkt kan dukke opp flere ganger ved per_product/turer)
  const agg = new Map<string, SnapshotItem>();
  for (const r of rows) {
    const cur = agg.get(r.product_id);
    if (cur) {
      cur.quantity_ordered += r.quantity_ordered;
      cur.quantity_from_stock += r.quantity_from_stock;
      cur.quantity_to_produce += r.quantity_to_produce;
      cur.trays_full += r.trays_full;
      cur.trays_partial += r.trays_partial;
    } else {
      agg.set(r.product_id, {
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
