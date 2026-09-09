import { describe, expect, it } from "vitest";
import { GRAIN_CLASSIFICATION_OPTIONS } from "@/varer/lib/breadscale";

/**
 * Nøyaktig sett av verdier tillatt av databasens
 * raw_materials_grain_classification_check (verifisert mot databasen).
 */
const ALLOWED_DB_VALUES = [
  "sifted_flour",
  "whole_grain_flour",
  "whole_grains",
  "wheat_bran",
  "rye_bran",
  "oat_bran",
  "gluten_free_grain",
  "other_flour",
  "not_grain",
];

describe("GRAIN_CLASSIFICATION_OPTIONS — samsvarer med DB-constraint", () => {
  it("hver verdi i lista finnes i den innsjekkede kopien av DB-constrainten", () => {
    for (const opt of GRAIN_CLASSIFICATION_OPTIONS) {
      expect(ALLOWED_DB_VALUES).toContain(opt.value);
    }
  });

  it("inneholder ikke de fjernede verdiene gluten_or_germ eller malt_or_improver", () => {
    const values = GRAIN_CLASSIFICATION_OPTIONS.map((o) => o.value);
    expect(values).not.toContain("gluten_or_germ");
    expect(values).not.toContain("malt_or_improver");
  });
});
