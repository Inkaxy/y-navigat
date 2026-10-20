import { describe, expect, it } from "vitest";
import {
  approvedContent,
  contentHash,
  exportDecision,
  type ApprovedVersion,
} from "../../supabase/functions/_shared/declaration-export";
import { hasPublishedSnapshot, syncAutoProductsForRecipe } from "../../supabase/functions/_shared/effective-declaration";
import { productLabelingStatus } from "@/varer/pages/ProductList";
import { deriveLabelingStatusFromDb, matchesLabelingFilter, LABELING_STATUS_LABEL } from "@/varer/lib/labelStaleness";
import { filterProducts } from "@/varer/lib/productListFilter";
import { parseProductListParams } from "@/varer/lib/listUrlState";

const v1: ApprovedVersion = {
  id: "ver-1",
  version: 1,
  approved_at: "2026-10-01T10:00:00Z",
  ingredient_text: "Hvetemel (*hvete*), vann, salt",
  allergens_contains: ["hvete"],
  allergens_may_contain: ["sesam"],
  nutrition_per_100g: { energy_kj: 1000, salt_g: 1.1 },
  shelf_life_days: 3,
  storage_text: "Tørt",
  origin_text: "Norge",
  claim_grain: true,
  claim_keyhole: false,
  breadscale_pct: 60,
};

const base = {
  ingredientText: v1.ingredient_text,
  versionId: "ver-1",
  version: v1,
  calculated: { computed_at: "2026-10-01T09:00:00Z", is_stale: false },
};

describe("publisert deklarasjon etter råvareendring", () => {
  it("godkjent vare forblir i eksporten med identisk innhold; bare review-flagget endres", async () => {
    const before = exportDecision({ ...base, needsReview: false });
    const after = exportDecision({
      ...base,
      needsReview: true,
      calculated: { computed_at: "2026-10-01T09:00:00Z", is_stale: true },
    });
    expect(before).toMatchObject({ include: true, source: "approved_version", needsReview: false });
    expect(after).toMatchObject({ include: true, source: "approved_version", needsReview: true });
    const a = approvedContent(v1, "auto");
    const b = approvedContent(v1, "auto");
    expect(b).toEqual(a);
    expect(await contentHash(b)).toBe(await contentHash(a));
    expect(a.grain).toMatchObject({ level: "grovt", pct: 60 });
    expect(a.nutrition_per_100g).toEqual({ energy_kj: 1000, salt_g: 1.1 });
  });

  it("ny godkjenning erstatter snapshotet", async () => {
    const v2: ApprovedVersion = { ...v1, id: "ver-2", version: 2, ingredient_text: "Hvetemel, vann", breadscale_pct: 20 };
    expect(exportDecision({ ...base, needsReview: false, versionId: "ver-2", version: v2 }).include).toBe(true);
    const c = approvedContent(v2, "auto");
    expect(c.ingredient_text).toBe("Hvetemel, vann");
    expect(c.grain?.level).toBe("fint");
    expect(await contentHash(c)).not.toBe(await contentHash(approvedContent(v1, "auto")));
  });

  it("aldri godkjent vare eksporteres ikke", () => {
    const d = exportDecision({ ingredientText: null, needsReview: true, calculated: null, versionId: null, version: null });
    expect(d.include).toBe(false);
  });

  it("eldre vare uten versjon følger den strenge regelen", () => {
    expect(exportDecision({ ...base, versionId: null, version: null, needsReview: false })).toMatchObject({ include: true, source: "legacy" });
    expect(exportDecision({ ...base, versionId: null, version: null, needsReview: true }).include).toBe(false);
  });

  it("peker versjonen til en rad som ikke ble funnet, brukes ikke snapshotet blindt", () => {
    expect(exportDecision({ ...base, needsReview: true, version: null }).include).toBe(false);
  });
});

const product = {
  id: "p1", display_number: 1, code: "k", display_name: "Kneipp", product_category: "brod",
  product_subcategory: null, main_category: null, sub_category: null, unit_of_sale: "stk",
  status: "active" as const, variant_of_product_id: null, variant_label: null, label_mode: null,
  is_cake_component: null, cake_role: null, image_url: null, pieces_per_tray: null, in_web_shop: null,
  in_pos: null, manual_ingredient_declaration: "Hvetemel" as string | null, declaration_needs_review: false as boolean | null,
  declaration_version_id: "ver-1" as string | null, calc_type: null, manual_cost_price: null,
};

describe("vareliste og filtre", () => {
  const reviewed = { ...product, declaration_needs_review: true };
  const never = { ...product, id: "p2", manual_ingredient_declaration: null, declaration_version_id: null, declaration_needs_review: true };

  it("godkjent vare med ventende endringer er «Krever gjennomgang», ikke borte", () => {
    expect(productLabelingStatus(reviewed, { computed_at: "2026-10-11T20:05:49Z", is_stale: true })).toBe("stale");
    expect(LABELING_STATUS_LABEL.stale).toBe("Krever gjennomgang");
  });

  it("Godkjent-filteret inkluderer ventende endringer; review-filteret bare dem", () => {
    const all = [product, reviewed, never];
    const of = (p: typeof product) => productLabelingStatus(p, undefined);
    const approvedState = parseProductListParams(new URLSearchParams("merking=approved"));
    const staleState = parseProductListParams(new URLSearchParams("merking=stale"));
    expect(filterProducts(all, approvedState, of).map((p) => p.id)).toEqual(["p1", "p1"]);
    expect(filterProducts(all, staleState, of)).toEqual([reviewed]);
  });

  it("aldri godkjent vises ikke som godkjent", () => {
    expect(productLabelingStatus(never, undefined)).toBe("missing");
    expect(matchesLabelingFilter("missing", "approved")).toBe(false);
  });

  it("oppskrift med godkjenning forblir godkjent-med-gjennomgang ved utdatert/manglende beregning", () => {
    expect(deriveLabelingStatusFromDb({ approvedAt: "2026-10-01T10:00:00Z", computedAt: "2026-10-01T09:00:00Z", isStale: true })).toBe("stale");
    expect(deriveLabelingStatusFromDb({ approvedAt: "2026-10-01T10:00:00Z", computedAt: null, isStale: null })).toBe("stale");
    expect(deriveLabelingStatusFromDb({ approvedAt: null, computedAt: "2026-10-01T09:00:00Z", isStale: false })).toBe("missing");
  });
});

type Update = { table: string; values: Record<string, unknown>; id: unknown };
function fakeService(links: unknown[]) {
  const updates: Update[] = [];
  const service = {
    from(table: string) {
      const q = {
        select: () => q,
        eq: (_c: string, v: unknown) => {
          if (table === "recipes") return { maybeSingle: async () => ({ data: { declaration_mode: "auto" }, error: null }) };
          if (table === "product_recipe_links") return Promise.resolve({ data: links, error: null });
          return Promise.resolve({ error: null, v });
        },
        update: (values: Record<string, unknown>) => ({
          eq: async (_c: string, id: unknown) => {
            updates.push({ table, values, id });
            return { error: null };
          },
        }),
      };
      return q;
    },
    functions: { invoke: async () => ({ data: null, error: new Error("ikke brukt") }) },
  };
  return { service, updates };
}

describe("beregningssynk", () => {
  const calc = { ingredient_declaration: "Ny tekst", allergens: { contains: [] }, nutrition_per_100g: null, coverage_by_weight_pct: 50 };

  it("overskriver eller nuller aldri en godkjent eller eldre publisert deklarasjon", async () => {
    const { service, updates } = fakeService([
      { id: "l1", product_id: "pv", declaration_mode: null, products: { declaration_version_id: "ver-1", manual_ingredient_declaration: "Gammel" } },
      { id: "l2", product_id: "pl", declaration_mode: null, products: { declaration_version_id: null, manual_ingredient_declaration: "Legacy" } },
    ]);
    // @ts-expect-error forenklet testklient
    await syncAutoProductsForRecipe(service, "r1", calc);
    expect(updates).toHaveLength(2);
    for (const u of updates) {
      expect(Object.keys(u.values).sort()).toEqual(["declaration_needs_review", "declaration_review_reason"]);
      expect(u.values.declaration_needs_review).toBe(true);
    }
  });

  it("hasPublishedSnapshot", () => {
    expect(hasPublishedSnapshot({ declaration_version_id: "v" })).toBe(true);
    expect(hasPublishedSnapshot({ manual_ingredient_declaration: " " })).toBe(false);
    expect(hasPublishedSnapshot(null)).toBe(false);
  });
});
