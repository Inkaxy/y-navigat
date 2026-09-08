import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

/**
 * Vi SKRIVER bare det kanoniske vokabularet i nutritionSource.ts.
 * En ny `source: "manual"` et sted i src/ ville gitt to navn på samme kilde
 * og ødelagt tellingen per kilde på dekningssiden.
 */
/** Filene som faktisk skriver til raw_material_nutrition. */
function nutritionFiles(): string[] {
  try {
    return execFileSync("rg", ["-l", "--glob", "!*.test.*", "raw_material_nutrition", "src"], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function grep(pattern: string): string[] {
  const files = nutritionFiles();
  if (files.length === 0) return [];
  try {
    const out = execFileSync("rg", ["-n", pattern, ...files], { encoding: "utf8" });
    return out.trim().split("\n").filter(Boolean);
  } catch {
    return []; // rg avslutter med 1 når ingenting ble funnet
  }
}

describe("kildevokabular for næringsdata", () => {
  it("ingen skriver source: \"manual\" i næringsfilene", () => {
    expect(grep(String.raw`source:\s*"manual"`)).toEqual([]);
  });

  it("ingen skriver source: \"leverandør_db\" i næringsfilene", () => {
    expect(grep(String.raw`source:\s*"leverand`)).toEqual([]);
  });
});
