/**
 * Bygging av ordrelinjer ved lagring av en eksisterende kundeordre.
 *
 * Kjerneregelen: en linjes IDENTITET er database-id-en, ikke produktet. En ny
 * linje med samme produkt som en eldre, manuelt priset linje skal derfor ha sin
 * egen ferske/bekreftede pris — og den gamle linjen skal beholde sin. Matching
 * på produkt (+ merknad) ville blandet de to, slik at skjermen viste én pris og
 * databasen fikk en annen.
 */
import { resolveLineVatRate } from "@/ordre/lib/orderRepricing";
import { resolveExistingLineId } from "@/ordre/lib/orderSaveResult";
import type { CustomerOrderLineInput } from "@/ordre/hooks/useCustomerOrders";

export type PrevLinePrice = {
  unit_price: number;
  unit_price_source: string | null;
  unit_price_source_id: string | null;
  vat_rate: number | null;
};

export type EffectivePriceEntry = {
  price: number;
  vat_rate: number;
  source: string;
  special_price_id: string | null;
  price_list_id: string | null;
  is_fallback: boolean;
};

export type OrderLineRow = {
  id: string | null;
  order_id: string;
  line_number: number;
  product_id: string;
  product_snapshot: Record<string, unknown>;
  quantity: number;
  sales_unit: string;
  unit_price: number;
  unit_price_source: string;
  unit_price_source_id: string | null;
  discount_percent: number;
  line_subtotal_excl_vat: number;
  vat_rate: number;
  line_vat: number;
  line_total_incl_vat: number;
  merknad: Record<string, unknown> | null;
  notes: string | null;
};

/**
 * Linje-id-ene slik de faktisk finnes i databasen. Kaster hvis klienten sender
 * en id som ikke ligger på ordren (samtidig endring fra en annen bruker).
 */
export function resolveLineIds(
  lines: readonly CustomerOrderLineInput[],
  existingIds: ReadonlySet<string>,
): (string | null)[] {
  return lines.map((l) => resolveExistingLineId(l.id ?? null, existingIds));
}

/**
 * Produktene som trenger et ferskt prisoppslag: kun NYE linjer (uten id) som
 * ikke allerede har en bekreftet priskilde fra skjermen.
 */
export function productIdsNeedingPrice(
  lines: readonly CustomerOrderLineInput[],
  resolvedLineIds: readonly (string | null)[],
): string[] {
  return Array.from(
    new Set(
      lines
        .filter((l, i) => resolvedLineIds[i] === null && !l.unit_price_source)
        .map((l) => l.product_id),
    ),
  );
}

export type BuildLineRowsResult = {
  rows: OrderLineRow[];
  /** Indeksene til linjer som endte på fallback-pris (0 kr eller fallback-kilde). */
  fallbackLineIndices: number[];
};

export function buildOrderLineRows(params: {
  orderId: string;
  lines: readonly CustomerOrderLineInput[];
  resolvedLineIds: readonly (string | null)[];
  existingById: ReadonlyMap<string, PrevLinePrice>;
  priceMap: ReadonlyMap<string, EffectivePriceEntry>;
}): BuildLineRowsResult {
  const { orderId, lines, resolvedLineIds, existingById, priceMap } = params;
  const fallbackLineIndices: number[] = [];

  const rows = lines.map((l, idx) => {
    const lineId = resolvedLineIds[idx] ?? null;
    // Kun raden med denne id-en kan gi historisk pris.
    const existing = lineId ? existingById.get(lineId) : undefined;
    let unitPrice: number;
    let vatRate: number;
    let source: string;
    let sourceId: string | null;
    if (l.unit_price_source) {
      // Eksplisitt priskilde fra skjermen (manuell overstyring eller prisen som
      // faktisk vises) — lagres nøyaktig slik den vises.
      unitPrice = l.unit_price;
      vatRate = resolveLineVatRate(existing?.vat_rate, l.product_mva_rate);
      source = l.unit_price_source;
      sourceId = l.unit_price_source_id ?? null;
    } else if (existing) {
      // Uendret eksisterende linje — behold avtalt/manuell pris og kilde.
      unitPrice = existing.unit_price;
      vatRate = resolveLineVatRate(existing.vat_rate, l.product_mva_rate);
      source = existing.unit_price_source ?? "unchanged";
      sourceId = existing.unit_price_source_id;
    } else {
      const ep = priceMap.get(l.product_id);
      unitPrice = ep ? ep.price : 0;
      vatRate = ep?.vat_rate ?? l.product_mva_rate ?? 15;
      source = ep?.source ?? "fallback_zero";
      sourceId = ep?.special_price_id ?? ep?.price_list_id ?? null;
      if (!ep || ep.is_fallback) fallbackLineIndices.push(idx);
    }

    const subtotal = l.quantity * unitPrice;
    const vat = subtotal * (vatRate / 100);
    return {
      id: lineId,
      order_id: orderId,
      line_number: idx + 1,
      product_id: l.product_id,
      product_snapshot: {
        display_number: l.product_display_number,
        display_name: l.product_display_name,
        code: l.product_code ?? null,
        unit_of_sale: l.product_unit_of_sale,
        mva_rate: vatRate,
      },
      quantity: l.quantity,
      sales_unit: l.product_unit_of_sale,
      unit_price: unitPrice,
      unit_price_source: source,
      unit_price_source_id: sourceId,
      discount_percent: 0,
      line_subtotal_excl_vat: Number(subtotal.toFixed(2)),
      vat_rate: vatRate,
      line_vat: Number(vat.toFixed(2)),
      line_total_incl_vat: Number((subtotal + vat).toFixed(2)),
      merknad: l.merknad ? (l.merknad as unknown as Record<string, unknown>) : null,
      notes: l.notes ?? null,
    } satisfies OrderLineRow;
  });

  return { rows, fallbackLineIndices };
}
