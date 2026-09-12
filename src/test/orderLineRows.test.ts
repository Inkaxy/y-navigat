import { describe, expect, it } from "vitest";
import {
  buildOrderLineRows,
  productIdsNeedingPrice,
  resolveLineIds,
  type EffectivePriceEntry,
  type PrevLinePrice,
} from "@/ordre/lib/orderLineRows";
import type { CustomerOrderLineInput } from "@/ordre/hooks/useCustomerOrders";

const PRODUCT = "prod-1";
const OLD_LINE = "line-old";

function line(over: Partial<CustomerOrderLineInput>): CustomerOrderLineInput {
  return {
    product_id: PRODUCT,
    product_display_number: 100,
    product_display_name: "Grovbrød",
    product_code: "GB",
    product_unit_of_sale: "stk",
    product_mva_rate: 15,
    quantity: 1,
    unit_price: 0,
    merknad: null,
    notes: null,
    ...over,
  };
}

const existingById = new Map<string, PrevLinePrice>([
  [
    OLD_LINE,
    {
      unit_price: 12,
      unit_price_source: "manual_override",
      unit_price_source_id: null,
      vat_rate: 25,
    },
  ],
]);

const priceMap = new Map<string, EffectivePriceEntry>([
  [
    PRODUCT,
    {
      price: 40,
      vat_rate: 15,
      source: "price_list",
      special_price_id: null,
      price_list_id: "pl-1",
      is_fallback: false,
    },
  ],
]);

describe("ny linje med samme produkt som en gammel, manuelt priset linje", () => {
  const lines = [
    // Eksisterende linje: manuell pris 12, ingen ny kilde fra skjermen.
    line({ id: OLD_LINE, quantity: 2 }),
    // NY linje for samme produkt, med sin egen ferske pris fra skjermen.
    line({
      id: null,
      quantity: 1,
      unit_price: 40,
      unit_price_source: "price_list",
      unit_price_source_id: "pl-1",
    }),
  ];
  const existingIds = new Set([OLD_LINE]);
  const resolved = resolveLineIds(lines, existingIds);

  it("regner den nye linjen som ny, ikke som den gamle", () => {
    expect(resolved).toEqual([OLD_LINE, null]);
  });

  it("lagrer visningsprisen på den nye linjen og bevarer den gamle prisen", () => {
    const { rows } = buildOrderLineRows({
      orderId: "order-1",
      lines,
      resolvedLineIds: resolved,
      existingById,
      priceMap,
    });
    expect(rows[0].id).toBe(OLD_LINE);
    expect(rows[0].unit_price).toBe(12);
    expect(rows[0].unit_price_source).toBe("manual_override");
    expect(rows[0].vat_rate).toBe(25);

    expect(rows[1].id).toBeNull();
    expect(rows[1].unit_price).toBe(40);
    expect(rows[1].unit_price_source).toBe("price_list");
    expect(rows[1].unit_price_source_id).toBe("pl-1");
    // Egen mva: den nye linjen arver ikke 25 % fra den gamle raden.
    expect(rows[1].vat_rate).toBe(15);
  });

  it("holder id-ene adskilt og gir hver linje sitt eget linjenummer", () => {
    const { rows } = buildOrderLineRows({
      orderId: "order-1",
      lines,
      resolvedLineIds: resolved,
      existingById,
      priceMap,
    });
    expect(rows.map((r) => r.line_number)).toEqual([1, 2]);
    expect(rows[0].id).not.toBe(rows[1].id);
  });

  it("henter fersk pris for en ny linje uten bekreftet kilde", () => {
    const withoutSource = [lines[0], line({ id: null, quantity: 1 })];
    const ids = resolveLineIds(withoutSource, existingIds);
    expect(productIdsNeedingPrice(withoutSource, ids)).toEqual([PRODUCT]);
    const { rows } = buildOrderLineRows({
      orderId: "order-1",
      lines: withoutSource,
      resolvedLineIds: ids,
      existingById,
      priceMap,
    });
    // Den nye linjen får prismotorens pris — ikke den gamle linjens 12 kr.
    expect(rows[1].unit_price).toBe(40);
    expect(rows[1].unit_price_source).toBe("price_list");
  });

  it("ber ikke om prisoppslag for eksisterende linjer", () => {
    expect(productIdsNeedingPrice(lines, resolved)).toEqual([]);
  });

  it("avviser en linje-id som ikke finnes på ordren", () => {
    expect(() => resolveLineIds([line({ id: "ukjent" })], existingIds)).toThrow(
      /endret av noen andre/,
    );
  });
});
