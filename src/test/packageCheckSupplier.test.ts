import { describe, it, expect } from "vitest";
import { packageCheck, type CheckInput, type SupplierPackageLink } from "@/ravarer/lib/rawMaterialSections";

const rm: CheckInput["rm"] = { is_packaging: true, item_type: "ravare", base_unit: "kg", category: "Emballasje", categories: null, declaration_name: null,
  package_size: null, package_unit: null, base_units_per_package: null, package_confirmed_at: null, package_confirmed_by: null };
const link = (o: Partial<SupplierPackageLink>): SupplierPackageLink => ({ supplier_id: "s1", supplierName: "Lev A", package_size: 100, package_unit: "g",
  base_units_per_package: 0.1, package_confirmed_at: "2026-10-14T10:00:00Z", package_confirmed_by: "u1", ...o });

describe("packageCheck: global vs leverandørpakning", () => {
  it("global null + bekreftet leverandørpakning er ok, peker til leverandør", () => {
    const c = packageCheck(rm, [link({})]);
    expect(c.status).toBe("ok");
    expect(c.section).toBe("leverandorer");
    expect(c.detail).toContain("Leverandørpakning bekreftet");
    expect(c.detail).toContain("Lev A");
  });
  it("global null + ingen kobling mangler", () => {
    const c = packageCheck(rm, []);
    expect(c.status).toBe("missing");
    expect(c.detail).toBe("Pakningsinnhold mangler");
  });
  it("flere ulike bekreftede pakninger velger ingen", () => {
    const c = packageCheck(rm, [link({}), link({ supplier_id: "s2", supplierName: "Lev B", base_units_per_package: 25, package_size: 25, package_unit: "kg" })]);
    expect(c.status).toBe("ok");
    expect(c.detail).toContain("2 leverandører");
  });
  it("ubekreftet leverandørpakning er ikke ok og peker til leverandøren", () => {
    const c = packageCheck(rm, [link({ package_confirmed_at: null, package_confirmed_by: null })]);
    expect(c.status).toBe("missing");
    expect(c.section).toBe("leverandorer");
    expect(c.detail).toContain("Lev A");
  });
  it("delvis: viser bare utestående leverandør", () => {
    const c = packageCheck(rm, [link({}), link({ supplier_id: "s2", supplierName: "Lev B", package_confirmed_at: null })]);
    expect(c.status).toBe("partial");
    expect(c.detail).toContain("ikke bekreftet for Lev B");
  });
});
