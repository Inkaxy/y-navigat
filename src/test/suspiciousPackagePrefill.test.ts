import { describe, expect, it } from "vitest";
import { suspiciousSupplierPrefill } from "@/ravarer/components/packages/SuspiciousPackagesCard";
import type { SuspiciousPackageRow } from "@/ravarer/hooks/useSuspiciousPackages";

function row(over: Partial<SuspiciousPackageRow> = {}): SuspiciousPackageRow {
  return {
    link_id: "l-1",
    raw_material_id: "rm-1",
    raw_material_name: "HVETEMEL 25 KG",
    base_unit: "kg",
    current_cost_price: 12.5,
    supplier_id: "s-1",
    supplier_name: "Norgesmøllene",
    supplier_product_name: "Hvetemel 25 kg",
    current_base_units: 5,
    suggested_base_units: 25,
    ...over,
  } as SuspiciousPackageRow;
}

describe("suspiciousSupplierPrefill", () => {
  it("sender den foreslåtte verdien, ikke dagens feilverdi", () => {
    expect(suspiciousSupplierPrefill(row())).toEqual({ supplierId: "s-1", supplierUnits: 25 });
  });

  it("gir ingen leverandørkobling uten leverandør", () => {
    expect(suspiciousSupplierPrefill(row({ supplier_id: null }))).toBeNull();
  });
});
