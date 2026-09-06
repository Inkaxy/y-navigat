import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Vakt mot at matchemotoren spør etter en kolonne som ikke finnes: PostgREST
 * avviser da HELE select-en, og alle fakturaer feiler med «Invoice not found».
 */
const FN = readFileSync(resolve("supabase/functions/match-invoice-lines/index.ts"), "utf8");
const TYPES = readFileSync(resolve("src/integrations/supabase/types.ts"), "utf8");

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

describe("match-invoice-lines select-strenger", () => {
  it.each(["invoices", "invoice_lines"])("bruker bare kolonner som finnes i %s", (table) => {
    const cols = rowColumns(table);
    const selects = selectsFor(table);
    expect(selects.length).toBeGreaterThan(0);
    for (const sel of selects) {
      if (sel.trim() === "*") continue;
      for (const raw of sel.split(",")) {
        const col = raw.trim();
        if (!col || col.includes("(")) continue;
        expect(cols.has(col), `${table}.${col} finnes ikke i types.ts`).toBe(true);
      }
    }
  });
});
