import type { ListSortKey } from "@/ravarer/lib/rawMaterialViews";

/** Kolonnene i varelisten. `name` er alltid synlig og kan ikke skjules. */
export interface ListColumn {
  id: string;
  label: string;
  sortKey: ListSortKey | null;
  numeric?: boolean;
  alwaysVisible?: boolean;
}

export const LIST_COLUMNS: ListColumn[] = [
  { id: "sku", label: "SKU", sortKey: "sku" },
  { id: "name", label: "Navn", sortKey: "name", alwaysVisible: true },
  { id: "category", label: "Kategori", sortKey: "category" },
  { id: "supplier", label: "Leverandør", sortKey: "supplier" },
  { id: "cost", label: "Kostpris", sortKey: "cost", numeric: true },
  { id: "agreed", label: "Avtalepris", sortKey: "agreed", numeric: true },
  { id: "deviation", label: "Avvik", sortKey: "deviation", numeric: true },
  { id: "package", label: "Pakning", sortKey: "package" },
  { id: "volume_12m", label: "Volum 12 mnd", sortKey: "volume_12m", numeric: true },
  { id: "last_invoice", label: "Siste faktura", sortKey: "last_invoice" },
  { id: "stock", label: "Beholdning", sortKey: null, numeric: true },
  { id: "status", label: "Status", sortKey: null },
  { id: "active", label: "Aktiv", sortKey: "active" },
];

/** Kolonner som er skjult inntil brukeren slår dem på. */
export const DEFAULT_HIDDEN_COLUMNS: string[] = ["stock"];


export function isColumnVisible(id: string, hidden: readonly string[]): boolean {
  const col = LIST_COLUMNS.find((c) => c.id === id);
  if (col?.alwaysVisible) return true;
  return !hidden.includes(id);
}
