import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Migrasjonene 8.–9. september 2026 ble kjørt direkte mot prosjektet.
 * Repoet skal ha én fil per kjørt versjon, slik at migrasjonsmotoren regner dem
 * som anvendt og ikke forsøker å kjøre dem på nytt.
 */
const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");
const PENDING_DIR = resolve(process.cwd(), "supabase/migrations-pending");

const VERSIONS = [
  "20260908162911",
  "20260908163016",
  "20260908163226",
  "20260908200801",
  "20260908200853",
  "20260908200957",
  "20260908201038",
  "20260908201311",
  "20260908201359",
  "20260908201457",
  "20260908201606",
  "20260908201725",
  "20260908201756",
  "20260908201849",
  "20260908203903",
  "20260908204026",
  "20260908204111",
  "20260908210029",
  "20260908210301",
  "20260908210428",
  "20260908210536",
  "20260908210659",
  "20260908210846",
  "20260908210956",
  "20260908211059",
  "20260909010540",
  "20260909010654",
  "20260909010927",
  "20260909011009",
  "20260909011118",
  "20260909011957",
  "20260909012149",
  "20260909012213",
  "20260909012423",
  "20260909012454",
];

describe("migrasjonsregister", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));

  it("har 35 versjoner fra 8.–9. september 2026", () => {
    expect(VERSIONS).toHaveLength(35);
  });

  it.each(VERSIONS)("har fil for versjon %s", (version) => {
    expect(files.some((f) => f.startsWith(`${version}_`))).toBe(true);
  });

  it("har ingen duplikate versjoner", () => {
    const versions = files.map((f) => f.slice(0, 14));
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("har ikke lenger mappen migrations-pending", () => {
    expect(existsSync(PENDING_DIR)).toBe(false);
  });
});
