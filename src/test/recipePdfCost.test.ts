import { describe, expect, it } from "vitest";
import { buildRecipePDFData, type BuildRecipePDFInput } from "@/varer/hooks/useRecipePDF";
import type { BakersLine, BakersRawMaterial } from "@/varer/lib/bakers";

const rm = (o: Partial<BakersRawMaterial>): BakersRawMaterial =>
  ({ id: "r", name: "Råvare", base_unit: "kg", current_cost_price: 10, cost_basis_status: "verifisert", ...o });
const line = (id: string, r: BakersRawMaterial, grams: number): BakersLine =>
  ({ id, recipe_part_id: "p", raw_material_id: r.id, quantity: grams, unit: "g", _rm: r } as BakersLine);

const input = (lines: BakersLine[]): BuildRecipePDFInput => ({
  name: "Brød", scaledUnits: 10, factor: 1, unitWeightGrams: 200, includeCosts: true,
  parts: [{ id: "p", name: "Deig", part_type: "main", preferment_kind: null, target_temp_celsius: null, ripe_time_hours: null, instructions: null }],
  lines, steps: [],
});

describe("oppskrift-PDF: kost bare fra verifiserte priser", () => {
  it("alle verifisert => full sum og per stk", () => {
    const d = buildRecipePDFData(input([line("a", rm({ id: "mel", name: "Mel" }), 1000), line("b", rm({ id: "vann", name: "Vann", current_cost_price: 0.5 }), 1000)]));
    expect(d.costs).toMatchObject({ incomplete: false, missing: [] });
    expect(d.costs?.total).toBeCloseTo(10.5);
    expect(d.costs?.perUnit).toBeCloseTo(1.05);
  });
  it("uverifisert pris => ingen total/per stk, grunn vises, linjen uten kost", () => {
    const d = buildRecipePDFData(input([line("a", rm({ id: "mel", name: "Mel" }), 1000), line("b", rm({ id: "smor", name: "Smør", cost_basis_status: "uverifisert" }), 500)]));
    expect(d.costs).toMatchObject({ total: null, perUnit: null, incomplete: true });
    expect(d.costs?.missing.map((m) => m.name)).toEqual(["Smør"]);
    expect(d.mainParts[0].lines.find((l) => l.id === "b")?.cost).toBeNull();
  });
  it("manglende pris og ikke hentet status gjør kalkylen ufullstendig, aldri 0 kr", () => {
    const d = buildRecipePDFData(input([
      line("a", rm({ id: "mel", name: "Mel", cost_basis_status: "mangler", current_cost_price: null }), 1000),
      line("b", rm({ id: "salt", name: "Salt", cost_basis_status: undefined }), 20),
    ]));
    expect(d.costs?.total).toBeNull();
    expect(d.costs?.missing).toHaveLength(2);
  });
  it("uten kost bestilt => ingen kostdata", () => {
    expect(buildRecipePDFData({ ...input([line("a", rm({}), 100)]), includeCosts: false }).costs).toBeNull();
  });
});
