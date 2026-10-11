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
  it("supplier_item-body setter primær og kobler ALLE åpne linjer (ingen line_ids)", () => {
    const ctx = { kind: "supplier_item" as const, supplierId: "s1", itemKey: "sku:a", inferLineId: "l1" };
    const draft = { ...initialDraft(ctx), name: "Hvetemel", units: "25", packageUnit: "kg" };
    const body = linkCreateBody(ctx, draft, "le-1");
    expect(body.supplier_id).toBe("s1");
    expect(body.item_key).toBe("sku:a");
    expect(body.set_primary).toBe(true);
    expect(body.line_ids).toBeUndefined();
    expect(body.package?.confirm).toBe(false);
    expect(body.new_raw_material?.name).toBe("Hvetemel");
    expect(body.package?.base_units_per_package).toBe(25);
  });
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: { ok: true, supplier_id: "s1", previous_supplier_id: null, link_created: false }, error: null })),
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "tok" } } })) },
  },
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
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ ok: true, supplier_id: null, previous_supplier_id: "s1", link_created: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await setPrimarySupplier("rm-1", null);
    expect(supabase.rpc).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/rest\/v1\/rpc\/rm_set_primary_supplier$/);
    expect(JSON.parse(String(init.body))).toEqual({ p_raw_material_id: "rm-1", p_supplier_id: null });
    expect(res.supplier_id).toBeNull();
    vi.unstubAllGlobals();
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

describe("1b-rettelser", () => {
  it("kostpris 0 avvises", async () => {
    const { validateCostPrice } = await import("@/ravarer/editors/costPriceLogic");
    const r = validateCostPrice({ price: "0", date: "2026-10-10", supplierId: null, source: "manual", reason: "Test", setAsCurrent: true });
    expect(r.ok).toBe(false);
  });
  it("pakningsforslag fyller grunnenhet, pakningsenhet og forhåndskrysser bekreftelse når enige", async () => {
    const { applyInference, initialDraft } = await import("@/ravarer/editors/createSheetLogic");
    const d = applyInference(initialDraft({ kind: "supplier_item", supplierId: "s", itemKey: "sku:1" }),
      { base_unit: "kg", suggested_bupp: 25, auto_confirmable: true, agrees: true, direct: false, line_unit: "sekk" }, "SEKK");
    expect(d).toMatchObject({ baseUnit: "kg", units: "25", packageUnit: "sekk", confirmPackage: true });
  });
  it("pakning er påkrevd når validering ber om det", async () => {
    const { validateCreate, initialDraft } = await import("@/ravarer/editors/createSheetLogic");
    const d = { ...initialDraft({ kind: "standalone" }), name: "Mel" };
    expect(validateCreate(d, { packageRequired: true })).toMatch(/pakningen/);
    expect(validateCreate(d)).toBeNull();
  });
  it("masseopprettelse dedupliserer per varekort", async () => {
    const { dedupeBySupplierItem } = await import("@/fakturaer/lib/bulkLink");
    const rows = [{ s: "a", k: "sku:1" }, { s: "a", k: "sku:1" }, { s: "b", k: "sku:1" }, { s: "a", k: null }];
    const r = dedupeBySupplierItem(rows, (x) => ({ supplierId: x.s, itemKey: x.k }));
    expect(r.unique).toHaveLength(3);
    expect(r.duplicates).toHaveLength(1);
  });
  it("statusfilter fra URL", async () => {
    const { parsePackageFilter, parsePackageStatusFilter } = await import("@/ravarer/lib/packageFilter");
    expect(parsePackageStatusFilter("ustabil_pris")).toBe("ustabil_pris");
    expect(parsePackageFilter("ustabil_pris")).toBe("alle");
  });
  it("tastesekvens g p", async () => {
    const { matchSequence } = await import("@/ravarer/ui/hotkeys");
    const b = [{ keys: ["g p"], sequence: ["g", "p"], description: "x", handler: () => undefined }];
    expect(matchSequence(b, "g", "p")).toBe(b[0]);
    expect(matchSequence(b, null, "p")).toBeNull();
  });
});
