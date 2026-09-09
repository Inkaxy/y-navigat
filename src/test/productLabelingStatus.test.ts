import { describe, it, expect } from "vitest";
import { productLabelingStatus } from "@/varer/pages/ProductList";

const baseProduct = {
  id: "p1",
  display_number: 1,
  code: "kneipp",
  display_name: "Kneipp",
  product_category: "brod",
  product_subcategory: null,
  main_category: null,
  sub_category: null,
  unit_of_sale: "stk",
  status: "active" as const,
  variant_of_product_id: null,
  variant_label: null,
  label_mode: null,
  is_cake_component: null,
  cake_role: null,
  image_url: null,
  pieces_per_tray: null,
  in_web_shop: null,
  in_pos: null,
  manual_ingredient_declaration: null as string | null,
  declaration_needs_review: null as boolean | null,
  calc_type: null,
  manual_cost_price: null,
};

describe("productLabelingStatus", () => {
  it("gir «missing» når det ikke finnes noen deklarasjon", () => {
    expect(productLabelingStatus(baseProduct, undefined)).toBe("missing");
  });

  it("gir «approved» når deklarasjon finnes og ingen beregnet rad krever ny gjennomgang", () => {
    const p = { ...baseProduct, manual_ingredient_declaration: "Hvetemel, vann, salt" };
    expect(productLabelingStatus(p, undefined)).toBe("approved");
  });

  it("gir «stale» når produktet er merket for ny gjennomgang uten beregnet rad", () => {
    const p = {
      ...baseProduct,
      manual_ingredient_declaration: "Hvetemel, vann, salt",
      declaration_needs_review: true,
    };
    expect(productLabelingStatus(p, undefined)).toBe("stale");
  });

  it("leser status fra beregnet etikett-rad når den finnes", () => {
    const p = { ...baseProduct, manual_ingredient_declaration: "Hvetemel, vann, salt" };
    const status = productLabelingStatus(p, { computed_at: new Date().toISOString(), is_stale: true });
    expect(status).toBe("stale");
  });
});
