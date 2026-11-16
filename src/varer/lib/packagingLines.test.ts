import { describe, expect, it } from "vitest";
import { diffPackaging, packagingCostPerUnit, toBatchQty, toPerUnit, type PackagingLine } from "./packagingLines";

const line = (p: Partial<PackagingLine>): PackagingLine => ({
  id: "a", updatedAt: "t", rawMaterialId: "eske", name: "Kakeeske", quantity: 20, unitPriceOverride: null, sortOrder: 0, ...p,
});

describe("emballasje i kalkylen", () => {
  it("antall per vare lagres per bakst", () => {
    expect(toBatchQty(1, 20)).toBe(20);
    expect(toPerUnit(20, 20)).toBe(1);
  });
  it("kost per vare deles på antall per bakst", () => {
    expect(packagingCostPerUnit([line({})], () => 4.5, 20)).toBeCloseTo(4.5);
  });
  it("manglende pris gir ukjent kost, ikke 0", () => {
    expect(packagingCostPerUnit([line({})], () => null, 20)).toBeNull();
    expect(packagingCostPerUnit([line({ unitPriceOverride: 3 })], () => null, 20)).toBeCloseTo(3);
  });
  it("forskjellen viser nye, endrede og fjernede linjer", () => {
    const saved = [line({ id: "a" }), line({ id: "b", rawMaterialId: "pose" })];
    const d = diffPackaging(saved, [line({ id: "a", quantity: 40 }), line({ id: null, rawMaterialId: "bånd" })]);
    expect(d.updates.map((x) => x.id)).toEqual(["a"]);
    expect(d.inserts.map((x) => x.rawMaterialId)).toEqual(["bånd"]);
    expect(d.deletes.map((x) => x.id)).toEqual(["b"]);
  });
});
