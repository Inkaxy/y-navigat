// «Nye varer»: leverandørchips når listen hentes sidevis. Ren logikk.
// Rask vei: antall per leverandør kommer fra serveren (alle leverandører, uavhengig av filteret).
// Dagens vei: bare «Alle» og valgt leverandør har kjent antall; øvrige chips vises uten tall (aldri et for lavt tall
// fra de radene som tilfeldigvis er hentet).
import type { SupplierCount } from "./newItemsPaging";

export type NewItemChip = { id: string | null; name: string; count: number | null };
type SupplierLike = { id: string; name: string; is_active?: boolean | null; track_invoice_lines?: boolean | null };
type RowLike = { supplier_id: string; supplier_name?: string | null };

export function newItemChips(o: {
  selected: string | null;
  selectedTotal: number | null;
  allTotal: number | null;
  serverCounts: readonly SupplierCount[] | null;
  rows: readonly RowLike[];
  suppliers: readonly SupplierLike[];
}): NewItemChip[] {
  const names = new Map(o.suppliers.map((s) => [s.id, s.name]));
  const byName = (a: NewItemChip, b: NewItemChip) => a.name.localeCompare(b.name, "nb");
  if (o.serverCounts) {
    const chips = o.serverCounts.filter((s) => s.count > 0 || s.supplier_id === o.selected)
      .map((s) => ({ id: s.supplier_id, name: s.supplier_name ?? names.get(s.supplier_id) ?? "Ukjent leverandør", count: s.count }));
    if (o.selected && !chips.some((c) => c.id === o.selected)) chips.push({ id: o.selected, name: names.get(o.selected) ?? "Ukjent leverandør", count: 0 });
    const all = o.serverCounts.reduce((n, s) => n + s.count, 0);
    return [{ id: null, name: "Alle leverandører", count: all }, ...chips.sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || byName(a, b))];
  }
  const ids = new Set<string>();
  for (const s of o.suppliers) if (s.track_invoice_lines && s.is_active !== false) ids.add(s.id);
  for (const r of o.rows) ids.add(r.supplier_id);
  if (o.selected) ids.add(o.selected);
  const rowName = new Map(o.rows.map((r) => [r.supplier_id, r.supplier_name ?? null]));
  const chips = [...ids].map((id) => ({
    id, name: names.get(id) ?? rowName.get(id) ?? "Ukjent leverandør",
    count: id === o.selected ? o.selectedTotal : null,
  })).sort(byName);
  return [{ id: null, name: "Alle leverandører", count: o.allTotal }, ...chips];
}
