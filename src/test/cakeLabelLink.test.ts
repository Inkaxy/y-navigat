import { describe, expect, it } from "vitest";
import { selectCakeLine, selectFirstFreeLabelUnit } from "@/ordre/lib/cakeImages";
import { resolveLabelNumber } from "@/ordre/lib/labelNumber";

describe("kakebilde og etikettkobling", () => {
  it("velger etikettvaren foran en kakevare uten etikett", () => {
    const selected = selectCakeLine(
      [
        { id: "blotkake", product_id: "p1", line_number: 1, product: { cake_role: "base", is_cake_component: true, label_mode: "none" } },
        { id: "spesial", product_id: "p2", line_number: 2, product: { cake_role: null, is_cake_component: false, label_mode: "per_unit" } },
      ],
      new Set(),
    );
    expect(selected?.id).toBe("spesial");
    expect(selected?.has_label_product).toBe(true);
  });

  it("velger laveste etikettlinje uten bilde og faller tilbake til første etikettlinje", () => {
    const lines = [
      { id: "line-1", product_id: "p1", line_number: 1, product: { cake_role: null, is_cake_component: false, label_mode: "per_unit" } },
      { id: "line-2", product_id: "p2", line_number: 2, product: { cake_role: null, is_cake_component: false, label_mode: "per_order" } },
    ];
    expect(selectCakeLine(lines, new Set(["line-1"]))?.id).toBe("line-2");
    expect(selectCakeLine(lines, new Set(["line-1", "line-2"]))?.id).toBe("line-1");
  });

  it("tildeler neste ledige enhet uten stille fallback", () => {
    const units = [
      { id: "u2", number: 12, unit_index: 2 },
      { id: "u1", number: 11, unit_index: 1 },
    ];
    expect(selectFirstFreeLabelUnit(units, new Set(["u1"]))?.id).toBe("u2");
    expect(selectFirstFreeLabelUnit(units, new Set(["u1", "u2"]))).toBeNull();
  });

  it("bruker label_units-nummer og faller tilbake til kopifeltet", () => {
    expect(resolveLabelNumber({ label_unit_id: "u1", label_number: "7" }, { u1: "42" })).toBe("42");
    expect(resolveLabelNumber({ label_unit_id: "u1", label_number: "7" }, {})).toBe("7");
    expect(resolveLabelNumber({ label_unit_id: null, label_number: null }, {})).toBeNull();
  });
});