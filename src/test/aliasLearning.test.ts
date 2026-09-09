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
      matchedSupplierLinkId: "l-mel",
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
      matchedSupplierLinkId: "l-mel",
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
      matchedSupplierLinkId: "l-mel",
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
      matchedSupplierLinkId: "l-mel",
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
      matchedSupplierLinkId: "l-mel",
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
      matchedSupplierLinkId: "l-mel",
      supplierLinks: links,
      existingAliases: [alias({})],
      confirmedAliases: [],
      rejectedRawMaterialIds: [],
      lineValues: [{ alias_type: "supplier_sku", alias_value: "12345" }],
    });
    expect(plan).toEqual({ supersedeIds: [], rejectExistingIds: [], rejectNewRows: [], confirmRows: [] });
  });
});


describe("planAliasLearning: confirmRows", () => {
  it("forfremmer et pending-alias på den matchede koblingen til confirmed", () => {
    const plan = planAliasLearning({
      rawMaterialId: "rm-1",
      matchedSupplierLinkId: "rms-1",
      supplierLinks: [{ id: "rms-1", raw_material_id: "rm-1" }],
      existingAliases: [
        {
          id: "alias-1",
          raw_material_supplier_id: "rms-1",
          alias_type: "supplier_sku",
          alias_value: "SKU-123",
          alias_value_normalized: "sku-123",
          status: "pending",
        },
      ],
      confirmedAliases: [{ alias_type: "supplier_sku", alias_value: "SKU-123" }],
      rejectedRawMaterialIds: [],
      lineValues: [],
    });

    expect(plan.confirmRows).toEqual([
      { raw_material_supplier_id: "rms-1", alias_type: "supplier_sku", alias_value: "SKU-123" },
    ]);
  });

  it("gir ingen confirmRows når ingenting bekreftes", () => {
    const plan = planAliasLearning({
      rawMaterialId: "rm-1",
      matchedSupplierLinkId: "rms-1",
      supplierLinks: [],
      existingAliases: [],
      confirmedAliases: [],
      rejectedRawMaterialIds: [],
      lineValues: [],
    });
    expect(plan.confirmRows).toEqual([]);
  });
});

describe("planAliasLearning: forfremmelse", () => {
  it("forfremmer pending på den matchede koblingen uten å pensjonere noe", () => {
    const plan = planAliasLearning({
      rawMaterialId: "rm-mel",
      matchedSupplierLinkId: "l-mel",
      supplierLinks: links,
      existingAliases: [
        alias({ id: "pending-1", raw_material_supplier_id: "l-mel", status: "pending" }),
      ],
      confirmedAliases: [{ alias_type: "supplier_sku", alias_value: "12345" }],
      rejectedRawMaterialIds: [],
      lineValues: [],
    });
    expect(plan.confirmRows).toEqual([
      { raw_material_supplier_id: "l-mel", alias_type: "supplier_sku", alias_value: "12345" },
    ]);
    expect(plan.supersedeIds).toEqual([]);
    expect(plan.rejectExistingIds).toEqual([]);
  });

  it("pensjonerer det samme aliaset når det står bekreftet på en annen kobling", () => {
    const plan = planAliasLearning({
      rawMaterialId: "rm-mel",
      matchedSupplierLinkId: "l-mel",
      supplierLinks: links,
      existingAliases: [
        alias({ id: "annen-kobling", raw_material_supplier_id: "l-sukker", status: "confirmed" }),
      ],
      confirmedAliases: [{ alias_type: "supplier_sku", alias_value: "12345" }],
      rejectedRawMaterialIds: [],
      lineValues: [],
    });
    expect(plan.supersedeIds).toEqual(["annen-kobling"]);
  });
});
