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
    for (const rid of ids.slice(a, b + 1)) on ? next.add(rid) : next.delete(rid);
    return next;
  }
  next.has(id) ? next.delete(id) : next.add(id);
  return next;
}

export function stepRow(ids: string[], current: string | null, dir: 1 | -1): string | null {
  if (ids.length === 0) return null;
  if (!current || !ids.includes(current)) return dir === 1 ? ids[0] : ids[ids.length - 1];
  const i = ids.indexOf(current) + dir;
  return ids[Math.min(ids.length - 1, Math.max(0, i))];
}
