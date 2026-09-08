import { describe, expect, it } from "vitest";
import { planAliasLearning } from "@/fakturaer/lib/aliasLearning";

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
