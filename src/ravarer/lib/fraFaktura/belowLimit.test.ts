import { describe, expect, it } from "vitest";
import { belowLimitJumps, priceJumps, type JumpLineInput } from "./priceJumps";
import { readinessFlags } from "@/ravarer/lib/decisions";

const line = (id: string, rm: string, sku: string, pct: number): JumpLineInput => ({
  id, invoice_id: `i-${id}`, raw_material_id: rm, supplier_sku: sku, description: sku, price_per_base_unit: 10 * (1 + pct / 100),
  expected_price_per_base_unit: 10, price_variance_pct: pct, review_reason: "price_variance", invoice_number: "F", invoice_date: "2026-11-01",
  supplier_id: "s1", rm_name: sku, rm_base_unit: "kg", rm_item_type: "ravare",
});

describe("mindre prisendringer under grensen (flyttet fra Beslutninger)", () => {
  it("hver leverandørvare havner i nøyaktig én av Prishopp og «under grensen»", () => {
    const lines = [line("a", "r1", "1", 30), line("b", "r2", "2", 5), line("c", "r3", "3", -20), line("d", "r4", "4", -21)];
    const limitFor = (rm: string) => (rm === "r1" ? 40 : 20);
    const over = priceJumps(lines, limitFor).map((j) => j.rawMaterialId).sort();
    const under = belowLimitJumps(lines, limitFor).map((j) => j.rawMaterialId).sort();
    expect(over).toEqual(["r4"]);
    expect(under).toEqual(["r1", "r2", "r3"]); // 30 % under egen grense 40 %, 5 %, nøyaktig 20 %
    expect(belowLimitJumps(lines, limitFor).find((j) => j.rawMaterialId === "r1")?.limit).toBe(40);
  });
});

describe("merker på varen", () => {
  const base = { id: "r", name: "X", allergens_reviewed_at: null, recipes: null, sold_as_product: null, used_as_packaging: null };
  it("bare kjente mangler gir merke", () => {
    expect(readinessFlags({ ...base, item_type: "videresalg", sold_as_product: false })).toEqual(["Handelsvare uten salgsvare"]);
    expect(readinessFlags({ ...base, item_type: "videresalg", sold_as_product: null })).toEqual([]);
    expect(readinessFlags({ ...base, item_type: "emballasje", used_as_packaging: false })).toEqual(["Emballasje uten kalkyle"]);
    expect(readinessFlags({ ...base, item_type: "ravare", recipes: 3 })).toEqual(["Allergener ikke kontrollert (3 oppskrifter)"]);
    expect(readinessFlags({ ...base, item_type: "ravare", recipes: 3, allergens_reviewed_at: "2026-11-01" })).toEqual([]);
    expect(readinessFlags({ ...base, item_type: "ravare", recipes: 0 })).toEqual([]);
  });
});
