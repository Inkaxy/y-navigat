import { describe, expect, it } from "vitest";
import { cheapestSupplier, costRuleExplanation, lastPurchaseBySupplier, parseCostRule, recognizedBy } from "./supplierPurchases";

describe("Leverandører og innkjøpspris (D5)", () => {
  const rows = [
    { supplier_id: "norges", price: 8.3, effective_date: "2026-11-06", snapshot_unit: "kg", is_credit: false },
    { supplier_id: "stange", price: -2, effective_date: "2026-10-01", snapshot_unit: "kg", is_credit: true },
    { supplier_id: "norges", price: 7.9, effective_date: "2026-09-01", snapshot_unit: "kg", is_credit: false },
    { supplier_id: "stange", price: 8.95, effective_date: "2026-09-12", snapshot_unit: "kg", is_credit: false },
    { supplier_id: "idun", price: 4, effective_date: "2026-08-01", snapshot_unit: "stk", is_credit: false },
  ];
  it("siste kjøp per leverandør hopper over kreditnota og eldre kjøp", () => {
    const m = lastPurchaseBySupplier(rows, "kg");
    expect(m.get("norges")).toEqual({ price: 8.3, date: "2026-11-06", comparable: true });
    expect(m.get("stange")?.price).toBe(8.95);
  });
  it("billigste bruker bare sammenlignbar enhet", () => {
    expect(cheapestSupplier(lastPurchaseBySupplier(rows, "kg"))).toBe("norges");
  });
  it("standard er siste kjøp fra hovedleverandør", () => {
    expect(parseCostRule(null)).toBe("hovedleverandor");
    expect(parseCostRule("billigste")).toBe("billigste");
    expect(parseCostRule("tull")).toBe("hovedleverandor");
    expect(costRuleExplanation("hovedleverandor", "Norgesmøllene", null)).toContain("Bruker siste kjøp fra Norgesmøllene");
  });
  it("kjennes igjen på varenummer og skrivemåter uten duplikater", () => {
    expect(recognizedBy("20411", [{ type: "supplier_sku", value: "20411" }, { type: "product_name", value: "HVETEMEL SIKTET 25KG" }, { type: "product_name", value: "hvetemel siktet 25kg" }]))
      .toEqual(["varenr 20411", "«HVETEMEL SIKTET 25KG»"]);
  });
});
