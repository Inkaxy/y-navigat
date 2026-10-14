import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANONICAL_PACKAGE_UNITS, isPackageUnit, normalizeUnit } from "@/fakturaer/lib/units";

/** Samme regel som match-invoice-lines bruker før den skriver `unit` tilbake ved ny matching. */
const rematchUnitUpdate = (unit: string) => { const n = normalizeUnit(unit); return n && n !== unit ? n : null; };

describe("pose er egen beholderenhet", () => {
  it("pose/poser/pos/bag beholder etiketten pose; sekk/sack forblir sekk", () => {
    for (const u of ["pose", "poser", "POS", "bag", "Bags"]) expect(normalizeUnit(u)).toBe("pose");
    for (const u of ["sekk", "sekker", "sk", "sack"]) expect(normalizeUnit(u)).toBe("sekk");
    expect(isPackageUnit("pose")).toBe(true);
    expect(CANONICAL_PACKAGE_UNITS).toContain("pose");
  });
  it("rettet linje i «pose» skrives ikke tilbake til «sekk» ved ny matching", () => {
    expect(rematchUnitUpdate("pose")).toBeNull();
    expect(rematchUnitUpdate("poser")).toBe("pose");
    expect(rematchUnitUpdate("sekk")).toBeNull();
  });
  it("matcheren bruker fortsatt den regelen og felles units.ts er byte-identisk", () => {
    const edge = readFileSync("supabase/functions/match-invoice-lines/index.ts", "utf8");
    expect(edge).toMatch(/const normalizedUnit = normalizeUnit\(line\.unit\);\s+if \(normalizedUnit && normalizedUnit !== line\.unit\)/);
    expect(readFileSync("src/fakturaer/lib/units.ts", "utf8")).toBe(readFileSync("supabase/functions/_shared/units.ts", "utf8"));
  });
});
