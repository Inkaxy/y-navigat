import type { MvaBreakdown, ProductSnapshot } from "@/pos_styring/lib/pos-types";

export type DiningMode = "takeaway" | "eatin";

export type CartItem = {
  id: string;
  product_id: string | null;
  product_snapshot: ProductSnapshot;
  quantity: number;
  unit_price_excl_mva: number;
  mva_rate: number;
  line_discount: number;
  dining_mode_override?: DiningMode | null;
  merknad?: string;
};

export type CartTotals = {
  subtotal_excl_mva: number;
  total_mva: number;
  total_incl_mva: number;
  mva_breakdown: MvaBreakdown;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function calcLine(item: CartItem) {
  const net = round2(item.quantity * item.unit_price_excl_mva - item.line_discount);
  const vat = round2((net * item.mva_rate) / 100);
  const gross = round2(net + vat);
  return { net, vat, gross };
}

export function calcTotals(items: CartItem[]): CartTotals {
  const buckets = new Map<number, { net: number; vat: number; gross: number }>();
  let subtotal = 0;
  let totalVat = 0;
  for (const it of items) {
    const { net, vat, gross } = calcLine(it);
    subtotal += net;
    totalVat += vat;
    const b = buckets.get(it.mva_rate) ?? { net: 0, vat: 0, gross: 0 };
    b.net += net;
    b.vat += vat;
    b.gross += gross;
    buckets.set(it.mva_rate, b);
  }
  const mva_breakdown: MvaBreakdown = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, b]) => ({
      rate,
      net: round2(b.net),
      vat: round2(b.vat),
      gross: round2(b.gross),
    }));
  return {
    subtotal_excl_mva: round2(subtotal),
    total_mva: round2(totalVat),
    total_incl_mva: round2(subtotal + totalVat),
    mva_breakdown,
  };
}

export type CustomerCartPayload = {
  items: Array<{
    label: string;
    display_number: string | null;
    quantity: number;
    unit: string | null;
    line_total: number;
  }>;
  totals: CartTotals;
  dining_mode: DiningMode;
  timestamp: number;
};

export function serializeForCustomer(
  items: CartItem[],
  totals: CartTotals,
  dining_mode: DiningMode,
): CustomerCartPayload {
  return {
    items: items.map((it) => ({
      label: it.product_snapshot.display_name,
      display_number: it.product_snapshot.display_number,
      quantity: it.quantity,
      unit: it.product_snapshot.unit,
      line_total: calcLine(it).gross,
    })),
    totals,
    dining_mode,
    timestamp: Date.now(),
  };
}
