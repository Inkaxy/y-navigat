import { describe, expect, it } from "vitest";
import {
  approvedLabelInput,
  defaultLabelSource,
  markedTextToHtml,
  publishedProductDeclaration,
} from "@/varer/lib/approvedLabel";

const v = {
  id: "ver-1", version: 3, approved_at: "2026-10-01T10:00:00Z",
  ingredient_text: "Hvetemel, vann", ingredient_html: "<strong>Hvete</strong>mel, vann",
  allergens_contains: ["hvete"], allergens_may_contain: [], nutrition_per_100g: { energy_kj: 1000 },
  coverage_pct: 95, net_weight_g: 500, shelf_life_days: 3, storage_text: null, origin_text: "Norge",
  claim_grain: false, claim_keyhole: true, breadscale_pct: null,
};
const product = {
  manual_ingredient_declaration: "Ny *beregnet* tekst", manual_allergens_contains: ["melk"],
  manual_allergens_may_contain: [], manual_nutrition_per_100g: { energy_kj: 2 },
};

describe("forhåndsvisning/utskrift bruker sist godkjente versjon", () => {
  it("godkjent er standard når versjon finnes, ellers kladd", () => {
    expect(defaultLabelSource(true)).toBe("approved");
    expect(defaultLabelSource(false)).toBe("draft");
  });

  it("versjonert produkt viser versjonen, ikke produktets eller beregningens felt", () => {
    const d = publishedProductDeclaration({ versionId: "ver-1", version: v, product });
    expect(d).toMatchObject({ kind: "approved_version", version: 3, contains: ["hvete"], ingredientHtml: "<strong>Hvete</strong>mel, vann" });
    expect(d?.nutrition).toEqual({ energy_kj: 1000 });
  });

  it("NULL i godkjent versjon er autoritativt — ingen fallback til beregning", () => {
    const l = approvedLabelInput(v);
    expect(l.grainPct).toBeNull();
    expect(l.claimGrain).toBe(false);
    expect(l.storageInstructions).toBeNull();
    expect(l.claimKeyhole).toBe(true);
  });

  it("manglende versjonsrad gir ingen godkjent visning", () => {
    expect(publishedProductDeclaration({ versionId: "ver-1", version: null, product })).toBeNull();
  });

  it("legacy uten versjon er eksplisitt merket; uten snapshot finnes ingenting godkjent", () => {
    expect(publishedProductDeclaration({ versionId: null, version: null, product })?.kind).toBe("legacy");
    expect(publishedProductDeclaration({ versionId: null, version: null, product: { ...product, manual_ingredient_declaration: null } })).toBeNull();
    expect(markedTextToHtml("a *hvete* <b>")).toBe("a <strong>hvete</strong> &lt;b&gt;");
  });
});
