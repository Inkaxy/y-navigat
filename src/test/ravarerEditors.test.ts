import { describe, it, expect, vi, beforeEach } from "vitest";
import { writePathFor, linkCreateBody, initialDraft } from "@/ravarer/editors/createSheetLogic";
import { validateCostPrice, toPriceHistoryInput } from "@/ravarer/editors/costPriceLogic";

describe("RawMaterialCreateSheet — skrivevei per kontekst", () => {
  it("standalone → create_raw_material", () => {
    expect(writePathFor({ kind: "standalone" })).toBe("create_raw_material");
  });
  it("supplier_item → link_supplier_item", () => {
    expect(writePathFor({ kind: "supplier_item", supplierId: "s1", itemKey: "sku:1" })).toBe("link_supplier_item");
  });
  it("datasheet → datasheet", () => {
    expect(writePathFor({ kind: "datasheet", datasheetId: "d", fileName: "x.pdf", aiFields: {} })).toBe("datasheet");
  });
  it("supplier_item-body setter primær og tar med linjer når gitt", () => {
    const ctx = { kind: "supplier_item" as const, supplierId: "s1", itemKey: "sku:a", lineIds: ["l1", "l2"] };
    const draft = { ...initialDraft(ctx), name: "Hvetemel", units: "25", packageUnit: "kg" };
    const body = linkCreateBody(ctx, draft, "le-1");
    expect(body.supplier_id).toBe("s1");
    expect(body.item_key).toBe("sku:a");
    expect(body.set_primary).toBe(true);
    expect(body.line_ids).toEqual(["l1", "l2"]);
    expect(body.new_raw_material?.name).toBe("Hvetemel");
    expect(body.package?.base_units_per_package).toBe(25);
  });
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(async () => ({ data: { ok: true, supplier_id: "s1", previous_supplier_id: null, link_created: false }, error: null })) },
}));

describe("PrimarySupplierControl — RPC-argumenter", () => {
  beforeEach(() => vi.clearAllMocks());
  it("kaller rm_set_primary_supplier med riktige nøkler", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { setPrimarySupplier } = await import("@/ravarer/lib/supplierLinkRpc");
    await setPrimarySupplier("rm-1", "s1");
    expect(supabase.rpc).toHaveBeenCalledWith("rm_set_primary_supplier", {
      p_raw_material_id: "rm-1",
      p_supplier_id: "s1",
    });
  });
  it("sender null for å fjerne primær", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { setPrimarySupplier } = await import("@/ravarer/lib/supplierLinkRpc");
    await setPrimarySupplier("rm-1", null);
    expect(supabase.rpc).toHaveBeenCalledWith("rm_set_primary_supplier", {
      p_raw_material_id: "rm-1",
      p_supplier_id: null,
    });
  });
});

describe("CostPriceEditor — validering", () => {
  const base = { price: "", date: "2026-10-10", supplierId: null, source: "manual" as const, reason: "", setAsCurrent: true };
  it("krever begrunnelse", () => {
    const r = validateCostPrice({ ...base, price: "12,50" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.reason).toBeDefined();
  });
  it("godtar desimalkomma", () => {
    const r = validateCostPrice({ ...base, price: "12,50", reason: "Ny levering" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.price).toBeCloseTo(12.5, 5);
  });
  it("avviser negativ pris", () => {
    const r = validateCostPrice({ ...base, price: "-1", reason: "Test test" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.price).toBeDefined();
  });
  it("mapper riktig til prishistorikk-input", () => {
    const r = toPriceHistoryInput("rm-1", { ...base, price: "7,25", reason: "Faktura 123", supplierId: "s-1" }, 7.25);
    expect(r).toEqual({ raw_material_id: "rm-1", supplier_id: "s-1", price: 7.25, effective_date: "2026-10-10", source: "manual", notes: "Faktura 123", set_as_current: true });
  });
});
