import { describe, expect, it } from "vitest";
import { fmtGrainDisplayPct, grainCategoryFromPct, grainDisplayPct } from "@/varer/lib/breadscale";
import { grainDisplayPct as sharedGrainDisplayPct } from "../../supabase/functions/_shared/grain-display";

// Beslutning 1 (Henrik, 12.11.2026): prosenten som går ut / vises med merket er
// helt tall rundet NED, slik at tallet alltid stemmer med kategorien.
const BOUNDARIES: Array<[number, number, string]> = [
  [25.9, 25, "fint"],
  [26.0, 26, "halvgrovt"],
  [50.9, 50, "halvgrovt"],
  [51.0, 51, "grovt"],
  [75.9, 75, "grovt"],
  [76.0, 76, "ekstra_grovt"],
  [25.6, 25, "fint"],
  [26.4, 26, "halvgrovt"],
  [0, 0, "fint"],
  [100, 100, "ekstra_grovt"],
];

describe.each([
  ["klient", grainDisplayPct],
  ["_shared", sharedGrainDisplayPct],
])("grainDisplayPct (%s)", (_name, fn) => {
  it.each(BOUNDARIES)("%s %% vises som %s og hører til %s", (pct, shown, category) => {
    expect(fn(pct)).toBe(shown);
    // Tallet som vises ligger alltid i samme kategori som uavrundet prosent.
    expect(grainCategoryFromPct(shown)).toBe(category);
    expect(grainCategoryFromPct(pct)).toBe(category);
  });

  it("null, tom og ugyldig verdi gir null — aldri 0", () => {
    expect(fn(null)).toBeNull();
    expect(fn(undefined)).toBeNull();
    expect(fn("")).toBeNull();
    expect(fn("abc")).toBeNull();
    expect(fn(Number.NaN)).toBeNull();
  });

  it("numeric fra databasen som tekst tolkes likt", () => {
    expect(fn("25.90")).toBe(25);
    expect(fn("50.9")).toBe(50);
  });
});

describe("fmtGrainDisplayPct", () => {
  it("formaterer helt tall med prosenttegn, null uten prosent", () => {
    expect(fmtGrainDisplayPct(25.6)).toBe("25 %");
    expect(fmtGrainDisplayPct(76)).toBe("76 %");
    expect(fmtGrainDisplayPct(null)).toBeNull();
  });
});
