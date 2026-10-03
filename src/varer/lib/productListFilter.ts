import type { ProductListState } from "@/varer/lib/listUrlState";
import type { LabelingStatus } from "@/varer/lib/labelStaleness";

export interface FilterableProduct {
  id: string;
  display_number: number;
  display_name: string;
  code: string;
  product_category: string;
  status: string;
  variant_of_product_id: string | null;
}

/**
 * Søk i varelisten: navn/kode/nr, intervall («1791-1800») eller liste
 * («12, 15 18»), pluss filtrene.
 */
export function filterProducts<T extends FilterableProduct>(
  all: T[],
  s: ProductListState,
  labelingOf: (p: T) => LabelingStatus,
): T[] {
  const q = s.q.trim().toLowerCase();
  const rangeMatch = q.match(/^(\d+)\s*-\s*(\d+)$/);
  let rangeFrom: number | null = null;
  let rangeTo: number | null = null;
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1], 10);
    const b = parseInt(rangeMatch[2], 10);
    rangeFrom = Math.min(a, b);
    rangeTo = Math.max(a, b);
  }
  const numberList = !rangeMatch && /^[\d\s,]+$/.test(q) && /[,\s]/.test(q)
    ? q.split(/[,\s]+/).map((v) => parseInt(v, 10)).filter((n) => !isNaN(n))
    : null;

  return all.filter((p) => {
    if (q) {
      if (rangeFrom !== null && rangeTo !== null) {
        if (p.display_number < rangeFrom || p.display_number > rangeTo) return false;
      } else if (numberList && numberList.length > 0) {
        if (!numberList.includes(p.display_number)) return false;
      } else if (!`${p.display_name} ${p.code} ${p.display_number}`.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (s.category !== "all" && p.product_category !== s.category) return false;
    if (s.status !== "all" && p.status !== s.status) return false;
    if (s.variant === "parents" && p.variant_of_product_id) return false;
    if (s.variant === "variants" && !p.variant_of_product_id) return false;
    if (s.labeling !== "all" && labelingOf(p) !== s.labeling) return false;
    return true;
  });
}
