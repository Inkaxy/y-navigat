/** Ren logikk for DataTable: sortering, utvalg og radnavigasjon. */
export type SortDir = "asc" | "desc";
export type SortValue = string | number | null | undefined;

export function compareValues(a: SortValue, b: SortValue): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // tomme verdier sist
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "nb", { numeric: true, sensitivity: "base" });
}

export function sortRows<T>(rows: T[], get: ((r: T) => SortValue) | undefined, dir: SortDir): T[] {
  if (!get) return rows;
  const out = [...rows];
  out.sort((x, y) => {
    const c = compareValues(get(x), get(y));
    // tomme verdier holdes sist uansett retning
    if (get(x) == null || get(y) == null) return c;
    return dir === "asc" ? c : -c;
  });
  return out;
}

/** Shift-klikk velger alle rader mellom forrige og denne. */
export function toggleSelection(ids: string[], selected: Set<string>, id: string, anchor: string | null, shift: boolean): Set<string> {
  const next = new Set(selected);
  if (shift && anchor && ids.includes(anchor)) {
    const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y);
    const on = !selected.has(id);
    for (const rid of ids.slice(a, b + 1)) {
      if (on) next.add(rid);
      else next.delete(rid);
    }
    return next;
  }
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function stepRow(ids: string[], current: string | null, dir: 1 | -1): string | null {
  if (ids.length === 0) return null;
  if (!current || !ids.includes(current)) return dir === 1 ? ids[0] : ids[ids.length - 1];
  const i = ids.indexOf(current) + dir;
  return ids[Math.min(ids.length - 1, Math.max(0, i))];
}

/** Minimal kolonnekontrakt for CSV — samme objekter som tabellen rendrer. */
export interface CsvColumn<T> {
  id: string;
  header: string;
  csv?: (row: T) => string;
  alwaysVisible?: boolean;
}

/** Synlige kolonner i DEFINISJONSREKKEFØLGE. Overskrift, celle og CSV bruker alle denne listen. */
export function visibleColumns<C extends { id: string; alwaysVisible?: boolean }>(columns: readonly C[], hidden: readonly string[]): C[] {
  const h = new Set(hidden);
  return columns.filter((c) => c.alwaysVisible || !h.has(c.id));
}

function csvCell(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * CSV for valgte rader × synlige kolonner, i radenes rekkefølge (som vist) og kolonnenes
 * definisjonsrekkefølge. Kolonner uten `csv` eksporteres tomme — aldri forskjøvet.
 */
export function tableCsv<T>(rows: readonly T[], cols: readonly CsvColumn<T>[], sep = ";"): string {
  const lines = [cols.map((c) => csvCell(c.header)).join(sep)];
  for (const r of rows) lines.push(cols.map((c) => csvCell(c.csv ? c.csv(r) : "")).join(sep));
  return lines.join("\n");
}

/** Klikk på kontroller i en rad skal ikke åpne/velge raden. */
export const INTERACTIVE_SELECTOR = 'a, button, input, select, textarea, label, [role="combobox"], [role="checkbox"], [role="button"], [contenteditable="true"]';
