import { describe, expect, it } from "vitest";
import { applySupplierSkuRules, supplierSkuRule } from "../../supabase/functions/_shared/supplierSkuRules.ts";
import { buildUserText, type Hints } from "../../supabase/functions/_shared/invoiceExtraction.ts";

const hints = (supplier_name: string): Hints => ({ expected_total_excl_vat: null, expected_total_incl_vat: null, expected_vat: null, supplier_name, invoice_number: null, is_credit: false, known_items: [] });

describe("ASKO: varenummerkolonnen", () => {
  it("«305-11», «331-1» og «305-1/1» er ikke varenummer; ekte varenumre beholdes uendret", () => {
    const out = applySupplierSkuRules([
      { sku: "305-11", sku_raw: "305-11" }, { sku: "331-1", sku_raw: "331-1" }, { sku: "305-1/1", sku_raw: "305-1/1" },
      { sku: "29 9727", sku_raw: "29 9727" }, { sku: "4048468", sku_raw: "4048468" },
    ], "ASKO ØST AS");
    expect(out.map((l) => l.sku)).toEqual([null, null, null, "29 9727", "4048468"]);
    expect(out[0].sku_raw).toBe("305-11"); // beviset beholdes
  });
  it("gjelder bare ASKO", () => {
    expect(applySupplierSkuRules([{ sku: "305-11" }], "A/S PALS")[0].sku).toBe("305-11");
    expect(supplierSkuRule("Idun Industri AS")).toBeNull();
  });
  it("leseren får ASKO-instruksen bare for ASKO", () => {
    expect(buildUserText(hints("ASKO ØST AS"), null, [])).toContain("Ta alltid med BEGGE gruppene");
    expect(buildUserText(hints("A/S PALS"), null, [])).not.toContain("ASKO-fakturaer");
  });
});
