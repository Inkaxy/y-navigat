import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Vi SKRIVER bare det kanoniske vokabularet i nutritionSource.ts.
 * En ny `source: "manual"` et sted i src/ ville gitt to navn på samme kilde
 * og ødelagt tellingen per kilde på dekningssiden.
 *
 * Testen leser filene selv (ingen `rg`-avhengighet): en manglende rg-binær
 * gjorde tidligere at testen alltid ble grønn uten å sjekke noe.
 */

/** Filer som ikke skal sjekkes — de definerer eller dokumenterer vokabularet. */
const EXEMPT = [
  "src/ravarer/lib/nutritionSource.ts",
  "src/test/nutritionSourceVocabulary.test.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Filene som faktisk skriver til raw_material_nutrition. */
function nutritionFiles(): { path: string; text: string }[] {
  return walk("src")
    .filter((p) => !EXEMPT.includes(p.replace(/\\/g, "/")))
    .map((path) => ({ path, text: readFileSync(path, "utf8") }))
    .filter((f) => f.text.includes("raw_material_nutrition"));
}

function hits(pattern: RegExp): string[] {
  return nutritionFiles()
    .filter((f) => pattern.test(f.text))
    .map((f) => f.path);
}

describe("kildevokabular for næringsdata", () => {
  it("finner faktisk næringsfilene som skal kontrolleres", () => {
    expect(nutritionFiles().length).toBeGreaterThan(0);
  });

  it('ingen skriver source: "manual" i næringsfilene', () => {
    expect(hits(/source:\s*"manual"/)).toEqual([]);
  });

  it('ingen skriver source: "leverandør_db" i næringsfilene', () => {
    expect(hits(/source:\s*"leverand/)).toEqual([]);
  });
});
