import { describe, expect, it, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

const { saveProductionPlanSnapshot, criteriaSignature } = await import(
  "@/produksjon/features/produksjonsplan/hooks/useProductionPlanSnapshots"
);
const { DEFAULT_CRITERIA } = await import("@/produksjon/features/produksjonsplan/types");

type Row = Parameters<typeof saveProductionPlanSnapshot>[4][number];

const row = (productId: string): Row =>
  ({
    product_id: productId,
    product_code: null,
    product_name: productId,
    unit_of_sale: "stk",
    main_category_id: null,
    main_category_code: null,
    main_category_name: null,
    sub_category_id: null,
    production_group_id: null,
    production_group_name: null,
    dough_type: null,
    pieces_per_tray: null,
    pieces_per_liter: null,
    quantity_ordered: 2,
    quantity_from_stock: 0,
    quantity_to_produce: 2,
    trays_full: 0,
    trays_partial: 0,
    liters: null,
    on_stock: null,
    tour_number: null,
  }) as unknown as Row;

const rows = [row("p-1"), row("p-2")];

describe("saveProductionPlanSnapshot", () => {
  beforeEach(() => rpc.mockReset());

  it("godtar svar som gjelder nøyaktig dette utskriftsforsøket", async () => {
    rpc.mockResolvedValue({ data: { id: "a-1", item_count: 2, already_saved: false }, error: null });
    const res = await saveProductionPlanSnapshot("a-1", "le-1", "2026-09-12", DEFAULT_CRITERIA, rows);
    expect(res).toEqual({ id: "a-1", itemCount: 2, alreadySaved: false });
  });

  it("avviser svar med en annen grunnlags-id", async () => {
    rpc.mockResolvedValue({ data: { id: "annen", item_count: 2 }, error: null });
    await expect(
      saveProductionPlanSnapshot("a-1", "le-1", "2026-09-12", DEFAULT_CRITERIA, rows),
    ).rejects.toThrow("et annet grunnlag");
  });

  it("avviser svar med for få lagrede varelinjer", async () => {
    rpc.mockResolvedValue({ data: { id: "a-1", item_count: 1 }, error: null });
    await expect(
      saveProductionPlanSnapshot("a-1", "le-1", "2026-09-12", DEFAULT_CRITERIA, rows),
    ).rejects.toThrow("1 av 2 varelinjer");
  });

  it("avviser tomt svar i stedet for å melde suksess", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(
      saveProductionPlanSnapshot("a-1", "le-1", "2026-09-12", DEFAULT_CRITERIA, rows),
    ).rejects.toThrow("uten bekreftelse");
  });
});

describe("criteriaSignature", () => {
  it("skiller sammenslåing til hovedvare", () => {
    const a = criteriaSignature({ ...DEFAULT_CRITERIA, merge_by_main_product: false });
    const b = criteriaSignature({ ...DEFAULT_CRITERIA, merge_by_main_product: true });
    expect(a).not.toBe(b);
  });

  it("tåler eldre, ufullstendige kriterier og bruker standardverdiene", () => {
    expect(() => criteriaSignature({})).not.toThrow();
    expect(criteriaSignature({})).toBe(criteriaSignature(DEFAULT_CRITERIA));
    expect(criteriaSignature(null)).toBe(criteriaSignature(DEFAULT_CRITERIA));
  });

  it("ignorerer rene utskriftsvalg", () => {
    expect(criteriaSignature({ ...DEFAULT_CRITERIA, print_correction_last: false })).toBe(
      criteriaSignature({ ...DEFAULT_CRITERIA, print_correction_last: true }),
    );
  });
});
