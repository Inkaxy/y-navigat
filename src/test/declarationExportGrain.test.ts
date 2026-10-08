import { describe, expect, it } from "vitest";
import { exportGrain } from "../../supabase/functions/_shared/declaration-export";

describe("exportGrain", () => {
  it("manuell prosent vinner når manuelt er valgt", () => {
    const g = exportGrain({ mode: "manual", manualPct: 55, calcCategory: "fint", calcPct: 10 });
    expect(g).toMatchObject({ level: "grovt", pct: 55, pieces: 3, pieces_total: 4, source: "manual" });
  });
  it("automatisk bruker beregnet kategori", () => {
    expect(exportGrain({ mode: "auto", manualPct: 90, calcCategory: "ekstra_grovt", calcPct: 77.25 }))
      .toMatchObject({ level: "ekstra_grovt", label: "Ekstra grovt", pct: 77.3, pieces: 4, source: "auto" });
  });
  it("uten grunnlag gir null", () => {
    expect(exportGrain({ mode: "auto", manualPct: null, calcCategory: null, calcPct: null })).toBeNull();
    expect(exportGrain({ mode: "manual", manualPct: null, calcCategory: "grovt", calcPct: 60 })).toBeNull();
  });
});
