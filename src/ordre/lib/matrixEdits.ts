/**
 * Rene hjelpefunksjoner for leveringskalender-matrisen.
 *
 * All logikk som avgjør hva en celle viser (lagret antall, ulagret endring
 * eller fastordre-«spøkelse») bor her, slik at rutenettet, «enkel tabell» og
 * summene alltid bruker nøyaktig samme regel.
 */
import type { MatrixCell, MatrixChange } from "@/ordre/hooks/useMatrix";
import { parseMerknad, type Merknad } from "@/ordre/lib/merknad";

export type CellKey = string; // `${date}|${tour_id}|${product_id}`

export function ckey(date: string, tourId: string, productId: string): CellKey {
  return `${date}|${tourId}|${productId}`;
}

export function parseCellKey(key: CellKey): {
  date: string;
  tourId: string;
  productId: string;
} {
  const [date, tourId, productId] = key.split("|");
  return { date, tourId, productId };
}

export function colKeyOf(date: string, tourId: string): string {
  return `${date}|${tourId}`;
}

/** Én ordrelinje uten tur — vises read-only i egen kolonne. */
export type NoTourEntry = {
  date: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  lineTotalInclVat: number;
  orderIds: string[];
  orderNumbers: string[];
};

export type ExistingIndex = {
  /** Summert antall per celle (flere ordre på samme dato|tur|produkt summeres). */
  qty: Record<CellKey, number>;
  /** Alle ordre-id-er som bidrar til cellen. */
  orderIds: Record<CellKey, string[]>;
  merknad: Record<CellKey, Merknad>;
  /** Celler med antall > 0 og pris 0 — «Pris ikke funnet». */
  fallback: Record<CellKey, true>;
  /** Første ordre-id per kolonne (dato|tur). */
  colOrderId: Map<string, string>;
  /** Linjer uten tur, nøkkel `${date}|${productId}`. */
  noTour: Map<string, NoTourEntry>;
};

export function aggregateExistingCells(cells: MatrixCell[]): ExistingIndex {
  const out: ExistingIndex = {
    qty: {},
    orderIds: {},
    merknad: {},
    fallback: {},
    colOrderId: new Map(),
    noTour: new Map(),
  };

  for (const c of cells) {
    const qty = Number(c.quantity) || 0;
    if (!c.delivery_tour_id) {
      const k = `${c.delivery_date}|${c.product_id}`;
      const prev = out.noTour.get(k);
      if (prev) {
        prev.quantity += qty;
        prev.lineTotalInclVat += Number(c.line_total_incl_vat) || 0;
        if (!prev.orderIds.includes(c.order_id)) prev.orderIds.push(c.order_id);
        if (c.order_number && !prev.orderNumbers.includes(c.order_number)) {
          prev.orderNumbers.push(c.order_number);
        }
      } else {
        out.noTour.set(k, {
          date: c.delivery_date,
          productId: c.product_id,
          quantity: qty,
          unitPrice: Number(c.unit_price) || 0,
          lineTotalInclVat: Number(c.line_total_incl_vat) || 0,
          orderIds: [c.order_id],
          orderNumbers: c.order_number ? [c.order_number] : [],
        });
      }
      continue;
    }

    const key = ckey(c.delivery_date, c.delivery_tour_id, c.product_id);
    out.qty[key] = (out.qty[key] ?? 0) + qty;

    const ids = out.orderIds[key] ?? (out.orderIds[key] = []);
    if (!ids.includes(c.order_id)) ids.push(c.order_id);

    const m = parseMerknad(c.merknad);
    if (m && !out.merknad[key]) out.merknad[key] = m;

    if (qty > 0 && Number(c.unit_price) === 0) out.fallback[key] = true;

    const ck = colKeyOf(c.delivery_date, c.delivery_tour_id);
    if (!out.colOrderId.has(ck)) out.colOrderId.set(ck, c.order_id);
  }

  return out;
}

export type GhostRuleInput = {
  key: CellKey;
  edits: Record<CellKey, string>;
  existingQty: Record<CellKey, number>;
  ghostMap: Map<string, number> | undefined;
  /** True når kolonnen (dato|tur) allerede har en materialisert ordre. */
  hasColumnOrder: (date: string, tourId: string) => boolean;
  /** True når kolonnen (dato|tur) har leveransepause. */
  isPausedCol: (date: string, tourId: string) => boolean;
};

/**
 * Fastordre-tallet som skal VISES i cellen (0 = ingen ghost).
 * Samme regel brukes i rutenett, enkel tabell og summer.
 */
export function visibleGhostQty(input: GhostRuleInput): number {
  const { key, edits, existingQty, ghostMap, hasColumnOrder, isPausedCol } = input;
  if (key in edits) return 0;
  if (existingQty[key]) return 0;
  const { date, tourId } = parseCellKey(key);
  if (!tourId) return 0;
  if (hasColumnOrder(date, tourId)) return 0;
  if (isPausedCol(date, tourId)) return 0;
  const g = ghostMap?.get(key) ?? 0;
  return g > 0 ? g : 0;
}

/** Effektivt antall som vises i cellen: endring → lagret → ghost. */
export function effectiveCellQty(input: GhostRuleInput): number {
  const { key, edits, existingQty } = input;
  if (key in edits) return Number(edits[key] || 0);
  const existing = existingQty[key] ?? 0;
  if (existing) return existing;
  return visibleGhostQty(input);
}

/** Endringer som skal sendes til save_matrix_changes. Aldri tom tur-id. */
export function computeDirtyChanges(
  edits: Record<CellKey, string>,
  existingQty: Record<CellKey, number>,
): MatrixChange[] {
  const out: MatrixChange[] = [];
  for (const [key, raw] of Object.entries(edits)) {
    const { date, tourId, productId } = parseCellKey(key);
    if (!tourId || !date || !productId) continue;
    const editedNum = Number(raw || 0);
    const existing = existingQty[key] ?? 0;
    if (editedNum === existing) continue;
    out.push({ date, tour_id: tourId, product_id: productId, quantity: editedNum });
  }
  return out;
}

export type TotalsInput = {
  products: { id: string; unit_price: number | null }[];
  columns: { date: string; tourId: string }[];
  edits: Record<CellKey, string>;
  existingQty: Record<CellKey, number>;
  ghostMap: Map<string, number> | undefined;
  hasColumnOrder: (date: string, tourId: string) => boolean;
  isPausedCol: (date: string, tourId: string) => boolean;
};

export type Totals = {
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  grand: number;
};

/** Kronesummer basert på nøyaktig de antallene cellene faktisk viser. */
export function computeTotals(input: TotalsInput): Totals {
  const { products, columns, edits, existingQty, ghostMap, hasColumnOrder, isPausedCol } = input;
  const rowTotals: Record<string, number> = {};
  const colTotals: Record<string, number> = {};
  let grand = 0;

  for (const p of products) {
    const price = p.unit_price ?? 0;
    let rowSum = 0;
    for (const c of columns) {
      const key = ckey(c.date, c.tourId, p.id);
      const qty = effectiveCellQty({
        key,
        edits,
        existingQty,
        ghostMap,
        hasColumnOrder,
        isPausedCol,
      });
      if (!qty || !price) continue;
      const amount = qty * price;
      rowSum += amount;
      const ck = colKeyOf(c.date, c.tourId);
      colTotals[ck] = (colTotals[ck] ?? 0) + amount;
    }
    rowTotals[p.id] = rowSum;
    grand += rowSum;
  }

  return { rowTotals, colTotals, grand };
}
