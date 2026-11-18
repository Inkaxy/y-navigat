import { describe, expect, it } from "vitest";
import { parseSaveOutcome, parseSettingsState, requireSaved, unwrapPending } from "@/ravarer/lib/fakturalesing/readingApi";
import { exampleChanges } from "@/ravarer/lib/fakturalesing/exampleSummary";
import { linkLearning, notItemLearning } from "@/ravarer/lib/fakturalesing/learningExample";

describe("Fakturalesing-innstillinger: ukjent er aldri suksess", () => {
  it("manglende databaseendring og ukjent utfall kaster", () => {
    expect(() => unwrapPending({ kind: "missing" })).toThrow(/Venter på databaseendringen/);
    expect(() => unwrapPending({ kind: "error", status: 500, code: null })).toThrow(/ukjent/);
  });
  it("lagring krever ok:true med revisjon", () => {
    expect(parseSaveOutcome({ ok: true })).toBeNull();
    expect(() => requireSaved({})).toThrow(/ukjent/);
    expect(() => requireSaved({ ok: false, code: "endret" })).toThrow(/andre har lagret/);
    expect(requireSaved({ ok: true, revision: 3 })).toBe(3);
  });
  it("innstillinger uten rad er AV med revisjon 0", () => {
    expect(parseSettingsState({ catalog: false, revision: 0 })).toMatchObject({ revision: 0, settings: { catalog: false, learning: false } });
    expect(parseSettingsState({ catalog: "true", revision: 2 })?.settings.catalog).toBe(false);
    expect(parseSettingsState({ catalog: true })).toBeNull();
  });
});

describe("Læring: hva en avgjørelse lagres som", () => {
  it("kobling med pakning blir pakningseksempel; direkte enhet blir kobling", () => {
    expect(linkLearning("Iste chai", { state: "valid", size: 6, unit: "l", baseUnit: "l", baseUnitsPerPackage: 6, direct: false }))
      .toEqual({ kind: "pakning", corrected: { raw_material_name: "Iste chai", base_unit: "l", package_size: 6, package_unit: "l", base_units_per_package: 6 } });
    expect(linkLearning("Egg", { state: "valid", size: 1, unit: "stk", baseUnit: "stk", baseUnitsPerPackage: 1, direct: true })?.kind).toBe("kobling");
    expect(linkLearning("Egg", { state: "empty" })).toBeNull();
    expect(notItemLearning()).toEqual({ kind: "ikke_vare", corrected: { not_item: true } });
  });
  it("retting vises før → etter med norske tall", () => {
    expect(exampleChanges({ quantity: 1, unit_price: 87.66 }, { quantity: 6, unit_price: 14.61 })).toEqual(["Antall: 1 → 6", "Enhetspris: 87,66 → 14,61"]);
    expect(exampleChanges({}, { not_item: true })).toEqual(["Ikke en vare"]);
  });
});
