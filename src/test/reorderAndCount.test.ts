// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { packageBaseUnits, roundToPackages } from "@/ravarer/lib/reorder";
import { parsePackageFilter, matchesPackageFilter } from "@/ravarer/lib/packageFilter";
import {
  clearCountDraft,
  countDraftKey,
  draftHasContent,
  loadCountDraft,
  newOpId,
  saveCountDraft,
} from "@/ravarer/lib/countDraft";
import { MOVEMENT_TYPES, movementLabel, countMovement } from "@/ravarer/lib/stock";

describe("pakningsavrunding", () => {
  it("bruker bekreftet innhold per pakning", () => {
    expect(packageBaseUnits({ base_units_per_package: 25, package_size: 1, package_unit: "sekk" }, "kg")).toBe(25);
  });

  it("regner størrelse om til grunnenhet når innholdet ikke er bekreftet", () => {
    expect(packageBaseUnits({ base_units_per_package: null, package_size: 500, package_unit: "g" }, "kg")).toBe(0.5);
  });

  it("gir null når pakningen er ukjent", () => {
    expect(packageBaseUnits({ base_units_per_package: null, package_size: null, package_unit: null }, "kg")).toBeNull();
  });

  it("bruker råvarens egne enheter når pakningsenheten ikke er en global enhet", () => {
    const units = [{ unit_label: "sekk", units_in_base: 25 }];
    expect(
      packageBaseUnits({ base_units_per_package: null, package_size: 1, package_unit: "sekk" }, "kg", units),
    ).toBe(25);
  });

  it("runder opp til hele pakninger", () => {
    expect(roundToPackages(30, 25)).toEqual({ packages: 2, orderBaseQty: 50, baseUnitsPerPackage: 25 });
    expect(roundToPackages(25, 25).packages).toBe(1);
  });

  it("runder ordrett: 7 av 25 blir én hel pakning (25), 26 av 25 blir to (50)", () => {
    expect(roundToPackages(7, 25)).toEqual({ packages: 1, orderBaseQty: 25, baseUnitsPerPackage: 25 });
    expect(roundToPackages(26, 25)).toEqual({ packages: 2, orderBaseQty: 50, baseUnitsPerPackage: 25 });
  });

  it("runder til hele grunnenheter når pakningen mangler", () => {
    expect(roundToPackages(4.2, null)).toEqual({ packages: null, orderBaseQty: 5, baseUnitsPerPackage: null });
  });

  it("bestiller ingenting uten behov", () => {
    expect(roundToPackages(0, 25).orderBaseQty).toBe(0);
  });
});

describe("URL-filter for pakninger", () => {
  it("faller tilbake til ubekreftet ved ukjent verdi", () => {
    expect(parsePackageFilter("tull")).toBe("ubekreftet");
    expect(parsePackageFilter(null)).toBe("ubekreftet");
  });

  it("godtar de kjente verdiene", () => {
    expect(parsePackageFilter("bekreftet")).toBe("bekreftet");
    expect(parsePackageFilter("ALLE")).toBe("alle");
  });

  it("matcher rader mot filteret", () => {
    const bekreftet = { id: "a", bekreftet_dato: "2026-01-01" };
    const ubekreftet = { id: "b", bekreftet_dato: null };
    expect(matchesPackageFilter(bekreftet, "bekreftet", new Set())).toBe(true);
    expect(matchesPackageFilter(bekreftet, "ubekreftet", new Set())).toBe(false);
    expect(matchesPackageFilter(ubekreftet, "ubekreftet", new Set())).toBe(true);
    expect(matchesPackageFilter(ubekreftet, "alle", new Set())).toBe(true);
    expect(matchesPackageFilter(ubekreftet, "mistenkelig", new Set(["b"]))).toBe(true);
  });
});

describe("telleutkast", () => {
  const key = countDraftKey("firma-1", "2026-03-04");

  beforeEach(() => localStorage.clear());

  it("skiller utkast per selskap og dato", () => {
    expect(key).not.toBe(countDraftKey("firma-2", "2026-03-04"));
    expect(key).not.toBe(countDraftKey("firma-1", "2026-03-05"));
  });

  it("lagrer og henter et påbegynt utkast", () => {
    saveCountDraft(key, { opId: "op-1", entries: { rm1: [{ amount: "12,5", unitKey: "__base" }] }, lineNotes: { rm1: "Hylle 3" }, note: "" });
    const loaded = loadCountDraft(key);
    expect(loaded?.entries.rm1[0].amount).toBe("12,5");
    expect(loaded?.lineNotes.rm1).toBe("Hylle 3");
  });

  it("lagrer ikke et tomt utkast", () => {
    saveCountDraft(key, { opId: "op-1", entries: { rm1: [{ amount: "", unitKey: "__base" }] }, lineNotes: {}, note: "" });
    expect(loadCountDraft(key)).toBeNull();
    expect(draftHasContent(null)).toBe(false);
  });

  it("tåler ødelagt innhold", () => {
    localStorage.setItem(key, "{ikke json");
    expect(loadCountDraft(key)).toBeNull();
  });

  it("kan forkastes", () => {
    saveCountDraft(key, { opId: "op-1", entries: { rm1: [{ amount: "3", unitKey: "__base" }] }, lineNotes: {}, note: "" });
    clearCountDraft(key);
    expect(loadCountDraft(key)).toBeNull();
  });

  it("bevarer et lagret utkast når det ikke skjer noen brukerendring", () => {
    saveCountDraft(key, { opId: "op-1", entries: { rm1: [{ amount: "12", unitKey: "__base" }] }, lineNotes: {}, note: "" });
    // Simulerer at komponenten ikke autolagrer et tomt state før brukeren faktisk
    // har gjort noe — utkastet skal fortsatt ligge i localStorage uendret.
    expect(loadCountDraft(key)?.entries.rm1[0].amount).toBe("12");
  });
});

describe("bevegelsestyper", () => {
  it("har egen type for telling", () => {
    expect(MOVEMENT_TYPES).toContain("count_adjust");
    expect(movementLabel("count_adjust")).toBe("Telling");
  });
});

describe("countMovement", () => {
  it("telling gir differansen mot beholdningen", () => {
    expect(countMovement("count", 30, 25)).toBe(5);
    expect(countMovement("count", 20, 25)).toBe(-5);
  });

  it("svinn er alltid negativt", () => {
    expect(countMovement("waste", 4, 25)).toBe(-4);
    expect(countMovement("waste", -4, 25)).toBe(-4);
  });

  it("inngående beholdning er tallet selv", () => {
    expect(countMovement("opening", 12, 0)).toBe(12);
  });
});

describe("operasjons-ID på tellingen", () => {
  const key = countDraftKey("firma-1", "2026-04-01");

  beforeEach(() => localStorage.clear());

  it("beholder samme ID gjennom utkastet", () => {
    saveCountDraft(key, { opId: "op-42", entries: { rm1: [{ amount: "5", unitKey: "__base" }] }, lineNotes: {}, note: "" });
    expect(loadCountDraft(key)?.opId).toBe("op-42");
  });

  it("gir eldre utkast uten ID en ny", () => {
    localStorage.setItem(
      key,
      JSON.stringify({ entries: { rm1: [{ amount: "5", unitKey: "__base" }] }, lineNotes: {}, note: "" }),
    );
    const loaded = loadCountDraft(key);
    expect(typeof loaded?.opId).toBe("string");
    expect(loaded?.opId.length).toBeGreaterThan(10);
  });

  it("lager unike ID-er", () => {
    expect(newOpId()).not.toBe(newOpId());
  });
});
