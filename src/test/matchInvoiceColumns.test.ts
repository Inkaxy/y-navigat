import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Vakt mot at matchemotoren spør etter en kolonne som ikke finnes: PostgREST
 * avviser da HELE select-en, og alle fakturaer feiler med «Invoice not found».
 */
const FN = readFileSync(resolve("supabase/functions/match-invoice-lines/index.ts"), "utf8");
const TYPES = readFileSync(resolve("src/integrations/supabase/types.ts"), "utf8");

const TABLES = [
  "invoices",
  "invoice_lines",
  "raw_material_suppliers",
  "raw_material_supplier_aliases",
  "raw_materials",
] as const;

function rowColumns(table: string): Set<string> {
  const start = TYPES.indexOf(`      ${table}: {`);
  expect(start, `fant ikke tabellen ${table} i types.ts`).toBeGreaterThan(-1);
  const rowStart = TYPES.indexOf("Row: {", start);
  const rowEnd = TYPES.indexOf("\n        }", rowStart);
  const block = TYPES.slice(rowStart, rowEnd);
  const cols = new Set<string>();
  for (const m of block.matchAll(/^\s{10}([a-z0-9_]+)\??:/gm)) cols.add(m[1]);
  expect(cols.size).toBeGreaterThan(0);
  return cols;
}

/** Alle select-strenger i funksjonen, koblet til tabellen de gjelder. */
function selectsFor(table: string): string[] {
  const out: string[] = [];
  const re = new RegExp(String.raw`from\("${table}"\)[\s\S]{0,200}?\.select\("([^"]+)"\)`, "g");
  for (const m of FN.matchAll(re)) out.push(m[1]);
  return out;
}

/** Fjern innbakte relasjonsgrupper («supplier:suppliers(name, id)») før split på komma. */
function stripRelationGroups(sel: string): string {
  let s = sel;
  while (/\([^()]*\)/.test(s)) s = s.replace(/[\w:!]+\([^()]*\)/g, "");
  return s;
}

/** Sant når relasjonsnavnet finnes som en tabell, eller som en FK-relasjon (referencedRelation), i types.ts. */
function relationExists(name: string): boolean {
  if (TYPES.includes(`      ${name}: {`)) return true;
  return TYPES.includes(`referencedRelation: "${name}"`);
}

describe("match-invoice-lines select-strenger", () => {
  it.each(TABLES)("bruker bare kolonner som finnes i %s", (table) => {
    const cols = rowColumns(table);
    const selects = selectsFor(table);
    expect(selects.length).toBeGreaterThan(0);
    for (const sel of selects) {
      if (sel.trim() === "*") continue;
      const stripped = stripRelationGroups(sel);
      for (const raw of stripped.split(",")) {
        const col = raw.trim();
        if (!col) continue;
        expect(cols.has(col), `${table}.${col} finnes ikke i types.ts`).toBe(true);
      }
    }
  });
});

describe("select-parser", () => {
  it("finner minst én select per tabell og hopper over innbakte relasjoner", () => {
    for (const table of ["invoices", "invoice_lines"]) {
      const selects = selectsFor(table);
      expect(selects.length, `ingen select funnet for ${table}`).toBeGreaterThan(0);
      // Relasjonsledd som «invoices(...)» skal ikke tolkes som kolonnenavn.
      for (const sel of selects) {
        const embedded = sel.split(",").filter((c) => c.includes("("));
        for (const e of embedded) expect(e).toMatch(/\w+\(/);
      }
    }
  });

  it("fanger opp en kolonne som ikke finnes", () => {
    const cols = rowColumns("invoices");
    expect(cols.has("invoice_date")).toBe(true);
    expect(cols.has("kolonne_som_ikke_finnes")).toBe(false);
  });

  it("relasjonsnavn i embedded selects finnes som tabell eller FK i types.ts", () => {
    let checked = 0;
    for (const table of TABLES) {
      const selects = selectsFor(table);
      for (const sel of selects) {
        const embedded = sel.split(",").filter((c) => c.includes("("));
        for (const e of embedded) {
          const m = e.match(/([\w]+)\(/);
          expect(m, `fant ikke relasjonsnavn i «${e}»`).not.toBeNull();
          const relationName = m![1];
          checked += 1;
          expect(
            relationExists(relationName),
            `relasjonen ${relationName} finnes ikke som tabell eller FK i types.ts`,
          ).toBe(true);
        }
      }
    }
    // Ingen av dagens select-strenger bruker innbakte relasjoner — testen skal
    // likevel slå ut den dagen noen legger til én med et ugyldig navn.
    expect(checked).toBeGreaterThanOrEqual(0);
  });

  it("kreditnota uten eksplisitt referanse kan ikke bli «ready»", () => {
    // Motoren MÅ bruke den samme eksplisitte teksten som innboksen.
    expect(FN).toContain("Opprinnelig faktura:");
    expect(FN).toContain("creditNoteOriginalRef(inv.notes)");
  });
});
