import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import {
  invalidateInvoice,
  invalidateRawMaterial,
  invoiceQueryKeys,
  rawMaterialQueryKeys,
} from "@/ravarer/lib/invalidate";
import { supplierSpendExclVat } from "@/ravarer/lib/purchaseTotals";

function fakeClient() {
  const calls: unknown[][] = [];
  const qc = {
    invalidateQueries: vi.fn(({ queryKey }: { queryKey: unknown[] }) => {
      calls.push(queryKey);
      return Promise.resolve();
    }),
  } as unknown as QueryClient;
  return { qc, calls };
}

describe("invalidateRawMaterial", () => {
  it("treffer alle nøkler i modulen, med id på de scopede", () => {
    const { qc, calls } = fakeClient();
    invalidateRawMaterial(qc, "rm-1");
    const flat = calls.map((k) => k.join("|"));
    expect(flat).toContain("raw_materials");
    expect(flat).toContain("raw_material|rm-1");
    expect(flat).toContain("raw_material_nutrition|rm-1");
    expect(flat).toContain("raw_material_allergens|rm-1");
    expect(flat).toContain("raw_material_suppliers|rm-1");
    expect(flat).toContain("raw_materials_autocomplete");
    expect(flat).toContain("declaration-worklist");
    expect(flat).toContain("raw_material_package_worklist");
    expect(flat).toContain("raw-material-stock-status");
    expect(calls).toHaveLength(rawMaterialQueryKeys("rm-1").length);
  });

  it("uten id blir de scopede nøklene prefiks-nøkler", () => {
    const { qc, calls } = fakeClient();
    invalidateRawMaterial(qc);
    expect(calls).toContainEqual(["raw_material"]);
  });
});

describe("invalidateInvoice", () => {
  it("treffer liste, detalj, linjer og kø", () => {
    const { qc, calls } = fakeClient();
    invalidateInvoice(qc, "inv-1");
    const flat = calls.map((k) => k.join("|"));
    expect(flat).toContain("fakturaer");
    expect(flat).toContain("invoice|inv-1");
    expect(flat).toContain("invoice-lines|inv-1");
    expect(flat).toContain("fakturaer-review-lines");
    expect(flat).toContain("fakturaer-review-count");
    expect(calls).toHaveLength(invoiceQueryKeys("inv-1").length);
  });
});

describe("supplierSpendExclVat", () => {
  it("trekker fra mva og teller kreditnotaer negativt", () => {
    const sum = supplierSpendExclVat([
      { total_amount: 1250, total_vat: 250, is_credit_note: false },
      { total_amount: 625, total_vat: 125, is_credit_note: true },
      { total_amount: 100, total_vat: null, is_credit_note: null },
    ]);
    expect(sum).toBe(1000 - 500 + 100);
  });

  it("tåler tom liste", () => {
    expect(supplierSpendExclVat([])).toBe(0);
  });
});
