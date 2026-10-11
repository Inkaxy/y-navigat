import type { LinkSupplierItemResult } from "@/fakturaer/lib/supplierItems";
import { reasonText } from "@/fakturaer/lib/supplierItems";

/** Én rad per varekort `(supplier_id, item_key)` — første vinner. Rader uten nøkkel beholdes for feilrapport. */
export function dedupeBySupplierItem<T>(rows: T[], keyOf: (r: T) => { supplierId: string; itemKey: string | null }): { unique: T[]; duplicates: T[] } {
  const seen = new Set<string>();
  const unique: T[] = [];
  const duplicates: T[] = [];
  for (const r of rows) {
    const k = keyOf(r);
    if (!k.itemKey) { unique.push(r); continue; }
    const id = `${k.supplierId}|${k.itemKey}`;
    if (seen.has(id)) duplicates.push(r);
    else { seen.add(id); unique.push(r); }
  }
  return { unique, duplicates };
}

export type BulkRowReport = { name: string; ok: boolean; text: string };

/** Norsk radrapport fra `link-supplier-item`-svaret. */
export function reportLinkRow(name: string, r: LinkSupplierItemResult): BulkRowReport {
  const why = [...new Set(r.failures.map((f) => reasonText(f.reason)))];
  if (r.still_open_lines > 0) {
    return { name, ok: true, text: `opprettet, men ${r.still_open_lines} ${r.still_open_lines === 1 ? "linje står" : "linjer står"} fortsatt åpne${why.length ? `: ${why.join(", ")}` : ""}` };
  }
  if (why.length) return { name, ok: true, text: `opprettet, men omregning feilet: ${why.join(", ")}` };
  return { name, ok: true, text: "opprettet" };
}

export const failedRow = (name: string, text: string): BulkRowReport => ({ name, ok: false, text: `feilet: ${text}` });
