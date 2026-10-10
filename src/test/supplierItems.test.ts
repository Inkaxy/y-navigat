import { describe, expect, it } from "vitest";
import { linkResultSummary, packageText, pctChange, reasonSummary, whatIsMissing, type SupplierItem } from "@/fakturaer/lib/supplierItems";
import { isOpenLine, nameFromDescription, needsPackage, suggestedBaseUnit } from "@/fakturaer/lib/linkFormLogic";

const item = (o: Partial<SupplierItem>): SupplierItem =>
  ({ status: "koblet", open_lines: 0, rm_id: "r", rm_name: "Hvetemel siktet", rm_base_unit: "kg", reasons_raw: null, base_units_per_package: null, package_unit: null, package_confirmed_at: null, ...o }) as SupplierItem;

describe("varekort", () => {
  it("årsaker på norsk, maks to + rest", () => {
    expect(reasonSummary("unknown_package_size,price_increase,unmatched")).toEqual(["Ukjent pakningsstørrelse", "Prisøkning", "+1"]);
    expect(reasonSummary("helt_ny")).toEqual(["Annen årsak"]);
  });
  it("forklarer manglende pakning i klartekst", () => {
    expect(whatIsMissing(item({ status: "mangler_pakning", open_lines: 8 }))).toBe(
      "Varen er koblet til Hvetemel siktet, men pakningen er ikke bekreftet — derfor kan ikke prisen per kg regnes ut på 8 linjer.",
    );
  });
  it("pakningstekst", () => {
    expect(packageText(item({ base_units_per_package: 25, package_unit: "sekk", package_confirmed_at: "2026-08-12" }))).toBe("25 kg per sekk · bekreftet");
    expect(packageText(item({}))).toBe("mangler");
    expect(packageText(item({ rm_id: null }))).toBe("—");
  });
  it("prisendring", () => {
    expect(pctChange(110, 100)).toBeCloseTo(10);
    expect(pctChange(1, null)).toBeNull();
  });
  it("resultatoppsummering med eksakte tall", () => {
    const s = linkResultSummary({
      ok: true, mode: "koblet", raw_material_id: "r", raw_material_supplier_id: "s", created_raw_material: false, lines_updated: 12, still_open_lines: 2, failures: [],
      invoices: [
        { invoice_id: "a", invoice_number: "1", status: "reconciled", reconciled_mode: "auto", rematched: true, requires_review_count: 0, review_reasons: [], auto_reconcile: true },
        { invoice_id: "b", invoice_number: "2", status: "pending", reconciled_mode: null, rematched: true, requires_review_count: 2, review_reasons: ["price_variance", "unknown_package_size"], auto_reconcile: false },
      ],
    });
    expect(s).toEqual(["12 linjer koblet på 2 fakturaer.", "1 faktura ble avstemt automatisk.", "2 linjer står fortsatt til kontroll: prisavvik (1), ukjent pakningsstørrelse (1)."]);
  });
});

describe("koblingsskjema", () => {
  it("pakning trengs bare når enheten ikke kan regnes om", () => {
    expect(needsPackage("kg", "kg")).toBe(false);
    expect(needsPackage("g", "kg")).toBe(false);
    expect(needsPackage("sekk", "kg")).toBe(true);
    expect(needsPackage("stk", "kg")).toBe(true);
  });
  it("foreslår grunnenhet fra varenavnet", () => {
    expect(suggestedBaseUnit({ description: { count: 1, size: 25, unit: "kg", total: 25, bupp: 25 } })).toBe("kg");
    expect(suggestedBaseUnit({ description: { count: 1, size: 5, unit: "dl", total: 5, bupp: 5 } })).toBe("l");
    expect(suggestedBaseUnit(null)).toBe("stk");
  });
  it("navn uten pakningsord", () => {
    expect(nameFromDescription("HVETEMEL SIKTET 25KG")).toBe("Hvetemel siktet");
  });
  it("åpen linje krever gjennomgang og åpen faktura", () => {
    expect(isOpenLine({ requires_review: true, invoice_status: "pending" })).toBe(true);
    expect(isOpenLine({ requires_review: true, invoice_status: "reconciled" })).toBe(false);
  });
});
