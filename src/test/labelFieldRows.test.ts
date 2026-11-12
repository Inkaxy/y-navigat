import { describe, expect, it } from "vitest";
import { buildLabelChecklist } from "@/varer/lib/labelChecklist";
import { buildLabelFieldRows } from "@/varer/lib/labelFieldRows";
import { grainClaimState, keyholeClaimState } from "@/varer/lib/labelClaims";
import { linkNetWeight } from "@/varer/lib/linkNetWeight";

const checklist = (over: Partial<Parameters<typeof buildLabelChecklist>[0]> = {}) =>
  buildLabelChecklist({
    productName: "Grovbrød",
    ingredientText: "*hvete*mel, vann",
    contains: ["hvete"],
    mayContain: [],
    netWeightGrams: 750,
    shelfLifeDays: null,
    storageInstructions: null,
    producerName: "Bakeri",
    producerAddress: "Gate 1, 3138 Sted",
    nutrition: null,
    coveragePct: 95,
    ...over,
  });

describe("buildLabelFieldRows", () => {
  it("bruker sjekklistens rader og nivåer, med opprinnelse som frivillig rad", () => {
    const c = checklist();
    const rows = buildLabelFieldRows(c.items, { countryOfOrigin: null });
    const all = [...rows.required, ...rows.other];
    expect(all.map((r) => r.key).sort()).toEqual([...c.items.map((i) => i.key), "origin"].sort());
    expect(rows.errorCount).toBe(c.errors.length);
    expect(all.find((r) => r.key === "origin")).toMatchObject({ level: "none", requirement: "frivillig", editor: "origin" });
  });

  it("skiller påkrevd fra anbefalt og frivillig slik sjekklisten gjør", () => {
    const rows = buildLabelFieldRows(checklist().items, { countryOfOrigin: "Norge" });
    expect(rows.other.map((r) => [r.key, r.requirement])).toEqual([
      ["may_contain", "frivillig"],
      ["storage", "anbefalt"],
      ["origin", "frivillig"],
    ]);
    expect(rows.required.find((r) => r.key === "shelf_life")).toMatchObject({ level: "error", editor: "shelf_life" });
    expect(rows.required.find((r) => r.key === "net_weight")).toMatchObject({ level: "ok", editor: "net_weight" });
    expect(rows.required.find((r) => r.key === "producer")?.editor).toBeNull();
  });
});

describe("labelClaims", () => {
  it("grovhet er låst uten effektiv prosent og følger valgt kilde", () => {
    expect(grainClaimState({ breadscaleMode: "auto", manualPct: 40, grainPct: null }).locked).toBe(true);
    expect(grainClaimState({ breadscaleMode: "manual", manualPct: 40, grainPct: null })).toMatchObject({ locked: false, effectivePct: 40 });
    expect(grainClaimState({ breadscaleMode: "auto", manualPct: null, grainPct: 0 }).locked).toBe(false);
  });
  it("Nøkkelhullet krever oppfylt og datadekning", () => {
    expect(keyholeClaimState({ coverageOk: true, status: "oppfylt" }).locked).toBe(false);
    expect(keyholeClaimState({ coverageOk: false, status: "oppfylt" }).locked).toBe(true);
    expect(keyholeClaimState({ coverageOk: true, status: "ukjent" }).locked).toBe(true);
  });
});

describe("linkNetWeight", () => {
  const recipe = { unitCount: 48, totalDoughG: 4560, finalWeightG: 4128, pieceWeightG: 95 };
  it("viser registrert vekt på koblingen med bekreftelse", () => {
    const r = linkNetWeight({ sales_unit_basis: "stk", sales_unit_weight_g: 86, sales_unit_confirmed_at: "2026-10-01T10:00:00Z", products: { weight_per_unit_grams: 90 } }, recipe);
    expect(r).toMatchObject({ grams: 86, source: "kobling", confirmedAt: "2026-10-01T10:00:00Z" });
  });
  it("faller tilbake til varens vekt, som ikke er bekreftet på koblingen", () => {
    const r = linkNetWeight({ sales_unit_basis: "stk", sales_unit_weight_g: null, sales_unit_confirmed_at: "2026-10-01T10:00:00Z", products: { weight_per_unit_grams: 90 } }, recipe);
    expect(r).toMatchObject({ grams: 90, source: "vare", confirmedAt: null });
  });
  it("foreslår antall emner × ferdigvekt", () => {
    const r = linkNetWeight({ sales_unit_basis: "flerpakk", units_per_sales_unit: 4 }, recipe);
    expect(r.suggestion).toEqual({ grams: 344, text: "4 × ferdigvekt 86 g" });
    expect(r.grams).toBeNull();
  });
  it("foreslår ingenting når salgsenheten ikke er bekreftet, og ukjent vekt er null", () => {
    const r = linkNetWeight({ sales_unit_basis: null }, recipe);
    expect(r.suggestion).toBeNull();
    expect(r.grams).toBeNull();
    expect(r.note).toMatch(/ikke bekreftet/);
  });
});
