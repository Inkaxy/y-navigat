import { describe, expect, it } from "vitest";
import { planAliasLearning, type AliasRecord } from "@/fakturaer/lib/aliasLearning";

const links = [
  { id: "l-mel", raw_material_id: "rm-mel" },
  { id: "l-sukker", raw_material_id: "rm-sukker" },
];

function alias(over: Partial<AliasRecord>): AliasRecord {
  return {
    id: "a1",
    raw_material_supplier_id: "l-sukker",
    alias_type: "supplier_sku",
    alias_value: "12345",
    alias_value_normalized: "12345",
    status: "confirmed",
    ...over,
  };
}

describe("planAliasLearning", () => {
  it("pensjonerer samme alias hos leverandøren når det peker på en annen vare", () => {
    const plan = planAliasLearning({
      rawMaterialId: "rm-mel",
      supplierLinks: links,
      existingAliases: [alias({ id: "gammel" })],
      confirmedAliases: [{ alias_type: "supplier_sku", alias_value: "12345" }],
      rejectedRawMaterialIds: [],
      lineValues: [],
    });
    expect(plan.supersedeIds).toEqual(["gammel"]);
  });

  it("rører ikke alias på varen som faktisk ble matchet", () => {
    const plan = planAliasLearning({
      rawMaterialId: "rm-mel",
      supplierLinks: links,
      existingAliases: [alias({ id: "egen", raw_material_supplier_id: "l-mel" })],
      confirmedAliases: [{ alias_type: "supplier_sku", alias_value: "12345" }],
      rejectedRawMaterialIds: [],
      lineValues: [],
    });
    expect(plan.supersedeIds).toEqual([]);
  });

  it("sammenligner normalisert, ikke tegn for tegn", () => {
    const plan = planAliasLearning({
      rawMaterialId: "rm-mel",
      supplierLinks: links,
      existingAliases: [
        alias({
          id: "navn",
          alias_type: "product_name",
          alias_value: "Hvetemel, 25 kg",
          alias_value_normalized: "hvetemel, 25 kg",
        }),
      ],
      confirmedAliases: [{ alias_type: "product_name", alias_value: "HVETEMEL 25 KG" }],
      rejectedRawMaterialIds: [],
      lineValues: [],
    });
    expect(plan.supersedeIds).toEqual(["navn"]);
  });

  it("avviser bortvalgte varer: oppdaterer eksisterende, setter inn nye", () => {
    const plan = planAliasLearning({
      rawMaterialId: "rm-mel",
      supplierLinks: links,
      existingAliases: [alias({ id: "finnes", raw_material_supplier_id: "l-sukker" })],
      confirmedAliases: [],
      rejectedRawMaterialIds: ["rm-sukker"],
      lineValues: [
        { alias_type: "supplier_sku", alias_value: "12345" },
        { alias_type: "product_name", alias_value: "Hvetemel 25 kg" },
      ],
    });
    expect(plan.rejectExistingIds).toEqual(["finnes"]);
    expect(plan.rejectNewRows).toEqual([
      {
        raw_material_supplier_id: "l-sukker",
        alias_type: "product_name",
        alias_value: "Hvetemel 25 kg",
      },
    ]);
  });

  it("avviser ikke det som allerede er avvist, og hopper over tomme verdier", () => {
    const plan = planAliasLearning({
      rawMaterialId: "rm-mel",
      supplierLinks: links,
      existingAliases: [alias({ id: "finnes", status: "rejected" })],
      confirmedAliases: [],
      rejectedRawMaterialIds: ["rm-sukker"],
      lineValues: [
        { alias_type: "supplier_sku", alias_value: "12345" },
        { alias_type: "product_name", alias_value: "" },
      ],
    });
    expect(plan.rejectExistingIds).toEqual([]);
    expect(plan.rejectNewRows).toEqual([]);
  });

  it("gjør ingenting uten bekreftede alias og uten bortvalgte varer", () => {
    const plan = planAliasLearning({
      rawMaterialId: "rm-mel",
      supplierLinks: links,
      existingAliases: [alias({})],
      confirmedAliases: [],
      rejectedRawMaterialIds: [],
      lineValues: [{ alias_type: "supplier_sku", alias_value: "12345" }],
    });
    expect(plan).toEqual({ supersedeIds: [], rejectExistingIds: [], rejectNewRows: [] });
  });
});
