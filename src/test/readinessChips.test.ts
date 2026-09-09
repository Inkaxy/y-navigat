import { describe, it, expect } from "vitest";
import { readinessChips, readinessStatusLabel } from "@/varer/lib/readinessChips";

describe("readinessChips / readinessStatusLabel", () => {
  it("gir norske chips for manglene i viewet", () => {
    const chips = readinessChips({ status: "C", mangler: ["calc_type_ikke_satt", "ukjent_felt"] });
    expect(chips).toEqual([
      { key: "calc_type_ikke_satt", label: "Kalkyletype ikke satt" },
      { key: "ukjent_felt", label: "ukjent_felt" },
    ]);
  });

  it("gir tom liste når det ikke mangler noe", () => {
    expect(readinessChips({ status: "A", mangler: [] })).toEqual([]);
  });

  it("viser tankestrek når raden mangler helt", () => {
    expect(readinessStatusLabel(null)).toBe("–");
    expect(readinessStatusLabel({ status: "B", mangler: [] })).toBe("B");
  });
});
