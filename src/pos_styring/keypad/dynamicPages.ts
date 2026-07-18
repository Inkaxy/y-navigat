// Dynamiske tastatur-sider: fyller/synker knapper fra en varegruppe i produktkatalogen.
// Prinsipp: knappene som er koblet til produktet vi finner i gruppa, generereres automatisk.
// Andre knapper på siden (funksjoner, kategori-lenker) rører vi ikke.

import { supabase } from "@/integrations/supabase/client";

export type SourceKind = "main_category" | "sub_category" | "production_group";

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  main_category: "Hovedvaregruppe",
  sub_category: "Underkategori",
  production_group: "Produksjonsgruppe",
};

export interface SourceGroupOption {
  id: string;
  display_name: string;
  code: string | null;
  sort_order: number | null;
}

export interface GroupProduct {
  id: string;
  display_name: string;
  pos_display_name: string | null;
}

export interface ExistingProductButton {
  id: string;
  product_id: string;
  display_label: string | null;
  grid_x: number;
  grid_y: number;
  grid_width: number;
  grid_height: number;
}

export interface PageDiff {
  toAdd: GroupProduct[];
  toRemove: ExistingProductButton[];
  toKeep: Array<{ button: ExistingProductButton; product: GroupProduct }>;
}

/** Hent tilgjengelige grupper for aktiv legal entity. */
export async function fetchSourceGroups(
  legalEntityId: string,
  kind: SourceKind,
): Promise<SourceGroupOption[]> {
  const table =
    kind === "main_category"
      ? "product_main_categories"
      : kind === "sub_category"
        ? "product_sub_categories"
        : "production_groups";
  const { data, error } = await supabase
    .from(table)
    .select("id, display_name, code, sort_order")
    .eq("legal_entity_id", legalEntityId)
    .eq("status", "active")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("display_name");
  if (error) throw error;
  return (data ?? []) as SourceGroupOption[];
}

/** Hent produkter i valgt gruppe som er markert i POS. */
export async function fetchGroupProducts(
  legalEntityId: string,
  kind: SourceKind,
  sourceId: string,
): Promise<GroupProduct[]> {
  const column =
    kind === "main_category"
      ? "main_category_id"
      : kind === "sub_category"
        ? "sub_category_id"
        : "production_group_id";
  const { data, error } = await supabase
    .from("products")
    .select("id, display_name, pos_display_name")
    .eq("legal_entity_id", legalEntityId)
    .eq(column, sourceId)
    .eq("in_pos", true)
    .eq("status", "active")
    .order("display_name");
  if (error) throw error;
  return (data ?? []) as GroupProduct[];
}

/** Hent eksisterende produkt-knapper på siden. */
export async function fetchExistingProductButtons(
  pageId: string,
): Promise<ExistingProductButton[]> {
  const { data, error } = await supabase
    .from("pos_keypad_buttons")
    .select("id, product_id, display_label, grid_x, grid_y, grid_width, grid_height")
    .eq("page_id", pageId)
    .eq("button_type", "product");
  if (error) throw error;
  return (data ?? [])
    .filter((row): row is ExistingProductButton => !!row.product_id)
    .map((row) => ({ ...row, product_id: row.product_id as string }));
}

export function computeDiff(
  existing: ExistingProductButton[],
  groupProducts: GroupProduct[],
): PageDiff {
  const groupById = new Map(groupProducts.map((p) => [p.id, p]));
  const existingIds = new Set(existing.map((b) => b.product_id));
  const toRemove = existing.filter((b) => !groupById.has(b.product_id));
  const toKeep = existing
    .filter((b) => groupById.has(b.product_id))
    .map((b) => ({ button: b, product: groupById.get(b.product_id)! }));
  const toAdd = groupProducts.filter((p) => !existingIds.has(p.id));
  return { toAdd, toRemove, toKeep };
}

interface Slot {
  x: number;
  y: number;
}

/** Enkel plassering: fyller ledige celler radvis. Beholder toKeep der de står. */
function computeFreeSlots(
  gridCols: number,
  gridRows: number,
  occupied: Set<string>,
  need: number,
): Slot[] {
  const slots: Slot[] = [];
  for (let y = 0; y < gridRows && slots.length < need; y++) {
    for (let x = 0; x < gridCols && slots.length < need; x++) {
      if (!occupied.has(`${x},${y}`)) slots.push({ x, y });
    }
  }
  return slots;
}

export interface ApplyOptions {
  layoutId: string;
  pageId: string;
  gridCols: number;
  gridRows: number;
  kind: SourceKind;
  sourceId: string;
  markDynamic: boolean;
}

/**
 * Utfør synk: sletter fjernede produktknapper, legger til nye i ledige celler,
 * og oppdaterer side-metadata. Andre knapp-typer på siden røres ikke.
 * Returnerer antall lagt til / fjernet.
 */
export async function applyDiff(
  diff: PageDiff,
  opts: ApplyOptions,
): Promise<{ added: number; removed: number; skipped: number }> {
  // 1) slett fjernede
  if (diff.toRemove.length > 0) {
    const { error } = await supabase
      .from("pos_keypad_buttons")
      .delete()
      .in(
        "id",
        diff.toRemove.map((b) => b.id),
      );
    if (error) throw error;
  }

  // 2) beregn okkuperte celler etter sletting: alle andre knapper + toKeep
  const { data: remainingButtons, error: rErr } = await supabase
    .from("pos_keypad_buttons")
    .select("grid_x, grid_y, grid_width, grid_height")
    .eq("page_id", opts.pageId);
  if (rErr) throw rErr;
  const occupied = new Set<string>();
  for (const b of remainingButtons ?? []) {
    for (let dy = 0; dy < b.grid_height; dy++) {
      for (let dx = 0; dx < b.grid_width; dx++) {
        occupied.add(`${b.grid_x + dx},${b.grid_y + dy}`);
      }
    }
  }
  const slots = computeFreeSlots(opts.gridCols, opts.gridRows, occupied, diff.toAdd.length);
  const rowsToInsert = diff.toAdd.slice(0, slots.length).map((p, i) => ({
    page_id: opts.pageId,
    button_type: "product" as const,
    product_id: p.id,
    display_label: p.pos_display_name ?? p.display_name,
    grid_x: slots[i].x,
    grid_y: slots[i].y,
    grid_width: 1,
    grid_height: 1,
    show_image: true,
  }));

  let added = 0;
  if (rowsToInsert.length > 0) {
    const { error } = await supabase.from("pos_keypad_buttons").insert(rowsToInsert);
    if (error) throw error;
    added = rowsToInsert.length;
  }
  const skipped = diff.toAdd.length - added;

  // 3) oppdater side-metadata
  const { error: pageErr } = await supabase
    .from("pos_keypad_pages")
    .update({
      is_dynamic: opts.markDynamic,
      source_kind: opts.kind,
      source_id: opts.sourceId,
      source_last_synced_at: new Date().toISOString(),
    })
    .eq("id", opts.pageId);
  if (pageErr) throw pageErr;

  return { added, removed: diff.toRemove.length, skipped };
}

/** Nullstill dynamisk-kobling uten å røre knapper. */
export async function clearPageSource(pageId: string): Promise<void> {
  const { error } = await supabase
    .from("pos_keypad_pages")
    .update({ is_dynamic: false, source_kind: null, source_id: null })
    .eq("id", pageId);
  if (error) throw error;
}
