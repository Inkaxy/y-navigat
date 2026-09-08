import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { highlightAllergens } from "@/varer/lib/allergenLabels";

describe("delte allergenfiler mot _shared", () => {
  it("allergenDiff.ts er byte-identisk med edge-versjonen", () => {
    expect(readFileSync("src/ravarer/lib/allergenDiff.ts", "utf8")).toBe(
      readFileSync("supabase/functions/_shared/allergen-diff.ts", "utf8"),
    );
  });

  it("allergenLabels.ts er byte-identisk med edge-versjonen", () => {
    expect(readFileSync("src/varer/lib/allergenLabels.ts", "utf8")).toBe(
      readFileSync("supabase/functions/_shared/allergen-labels.ts", "utf8"),
    );
  });
});

describe("highlightAllergens", () => {
  it("navngir allergenet når ingrediensnavnet ikke sier det", () => {
    expect(highlightAllergens("fløte", ["milk"])).toBe("fløte (<strong>melk</strong>)");
  });

  it("uthever i navnet uten parentes når ordet står der", () => {
    expect(highlightAllergens("hvetemel", ["gluten_wheat"])).toBe("<strong>hvete</strong>mel");
  });

  it("tar med begge allergenene", () => {
    const out = highlightAllergens("hvetemel og melk", ["gluten_wheat", "milk"]);
    expect(out).toContain("<strong>hvete</strong>");
    expect(out).toContain("<strong>melk</strong>");
  });

  it("dobbeltmarkerer ikke det som allerede er uthevet", () => {
    const out = highlightAllergens("<strong>melk</strong>", ["milk"]);
    expect(out).not.toContain("<strong><strong>");
  });

  it("ukjent kode endrer ingenting", () => {
    expect(highlightAllergens("sukker", ["ukjent"])).toBe("sukker");
  });
});
