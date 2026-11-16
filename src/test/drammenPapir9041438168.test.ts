// Gjenskaper Drammen Papir 9041438168 (16.11.2026): 6 sider, 170 344,30 kr eks. mva, gpt-6-luna.
// Hele-faktura-kallet: første svar tomt, andre svar kuttet (max_output_tokens). Sidelesingen svarte på
// alle sider, men oppsummeringssiden hadde ingen varelinjer og ble regnet som «feilet bolk»; fakturaen
// endte som done/no_lines «PDF-en ga ingen lesbare linjer» etter 3 forsøk.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runExtractionAttempts, checkSum, type Hints, type ParsedExtraction } from "../../supabase/functions/_shared/invoiceExtraction.ts";
import {
  chunkReason, directChunkReason, mergeChunkExtractions, pagesReadNoLinesMessage, planPageChunks, resolveChunkedRead,
  DIRECT_CHUNK_MIN_PAGES, type ChunkResult, type PageChunk,
} from "../../supabase/functions/_shared/chunkedExtraction.ts";
import { extractionOutcome } from "../../supabase/functions/tripletex-import-invoice-lines/extraction-outcome.ts";

const EXPECTED = 170344.3;
const hints = (p: Partial<Hints> = {}): Hints => ({
  expected_total_excl_vat: EXPECTED, expected_total_incl_vat: 212930.38, expected_vat: 42586.08, supplier_name: "Drammen Papir",
  invoice_number: "9041438168", known_items: [], is_credit: false, ...p,
});
const reply = (o: unknown) => ({ rawText: JSON.stringify(o), inputTokens: 8000, outputTokens: 2000 });
const truncation = () => Object.assign(new Error("Svaret ble ufullstendig (max_output_tokens)"), { kind: "incomplete", detail: "max_output_tokens" });
const line = (desc: string, total: number, page: number) => ({
  line_kind: "vare", description: desc, quantity: 1, unit: "stk", unit_price: total, total_amount: total, unit_price_basis: "per_unit", page_number: page,
});
// Fem varesider + én oppsummeringsside uten varelinjer.
const PAGE_TOTALS = [34000, 34000, 34000, 34000, 34344.3];

async function readChunk(c: PageChunk, mode: "ok" | "fail"): Promise<ChunkResult> {
  const r = await runExtractionAttempts({
    hints: hints({ expected_total_excl_vat: null }), examples: [], maxAttempts: 1, parseJson: JSON.parse, numberCheck: false,
    call: async () => {
      if (mode === "fail") throw new Error("OpenAI 500: overloaded");
      return reply({ lines: c.from <= 5 ? [line(`Papirvare side ${c.from}`, PAGE_TOTALS[c.from - 1], 1)] : [] });
    },
  });
  // Samme uttrykk som aiRead.ts: en side som svarte uten linjer er lest.
  return { chunk: c, data: r.best ?? r.lastParsed };
}

describe("Drammen Papir 9041438168: sidelesing lagres", () => {
  it("kuttet svar etter et tomt forsøk skjules ikke lenger", async () => {
    let n = 0;
    const r = await runExtractionAttempts({
      hints: hints(), examples: [], maxAttempts: 2, parseJson: JSON.parse,
      call: async () => { n++; if (n === 1) return reply({ lines: [] }); throw truncation(); },
    });
    expect(r.best?.lines.length ?? 0).toBe(0);
    expect(r.truncated).toBe(true);
    expect(chunkReason({ truncated: r.truncated, totalPages: 6, linesSum: 0, expectedExcl: EXPECTED, maxPageSeen: null })).toContain("kuttet");
  });

  it("seks sider leses side for side direkte", () => {
    expect(DIRECT_CHUNK_MIN_PAGES).toBe(5);
    expect(directChunkReason(6)).toContain("6 sider");
    expect(directChunkReason(4)).toBeNull();
    expect(directChunkReason(null)).toBeNull();
    expect(planPageChunks(6)).toHaveLength(6);
  });

  it("oppsummeringsside uten linjer er lest: sammensettingen brukes og treffer summen", async () => {
    const results = await Promise.all(planPageChunks(6).map((c) => readChunk(c, "ok")));
    const merged = mergeChunkExtractions(results);
    expect(merged.complete).toBe(true);
    expect(merged.data.lines).toHaveLength(5);
    expect(merged.data.lines.map((l) => l.page_number)).toEqual([1, 2, 3, 4, 5]);
    const dev = checkSum(merged.data.lines, EXPECTED, null, null, false).deviation_pct;
    const res = resolveChunkedRead({ single: { lines: [] } as unknown as ParsedExtraction, singleDev: null, merged, mergedDev: dev, chunkCount: 6 });
    expect(res.usedMerged).toBe(true);
    expect(res.best?.lines).toHaveLength(5);
    expect(res.pagesReadNoLines).toBe(false);
    expect(res.pagesRead).toBe(6);
    expect(Math.abs(dev ?? 99)).toBeLessThan(0.01);
  });

  it("én side feiler: linjene fra de andre sidene lagres med kontrollvarsel, selv om summen ikke treffer", async () => {
    const results = await Promise.all(planPageChunks(6).map((c) => readChunk(c, c.from === 3 ? "fail" : "ok")));
    const merged = mergeChunkExtractions(results);
    expect(merged.complete).toBe(false);
    const dev = checkSum(merged.data.lines, EXPECTED, null, null, false).deviation_pct;
    expect(Math.abs(dev ?? 0)).toBeGreaterThan(2);
    const res = resolveChunkedRead({ single: null, singleDev: null, merged, mergedDev: dev, chunkCount: 6 });
    expect(res.usedMerged).toBe(true);
    expect(res.best?.lines).toHaveLength(4);
    expect(res.issues.map((i) => i.code)).toEqual(["sidelesing_delvis"]);
    expect(res.issues[0].message).toContain("Side 3");
  });

  it("enkeltlesing med linjer beholdes når en ufullstendig sidelesing ikke er bedre", () => {
    const single = { lines: [line("A", 170000, 1)] } as unknown as ParsedExtraction;
    const merged = mergeChunkExtractions([{ chunk: { from: 1, to: 1 }, data: null }, { chunk: { from: 2, to: 2 }, data: { lines: [line("B", 10, 2)] } as unknown as ParsedExtraction }]);
    const res = resolveChunkedRead({ single, singleDev: -0.2, merged, mergedDev: -99, chunkCount: 2 });
    expect(res.usedMerged).toBe(false);
    expect(res.best).toBe(single);
  });

  it("sider lest uten noen linjer gir aldri «ingen lesbare linjer»", async () => {
    const empty = await Promise.all(planPageChunks(6).map(async (c) => ({ chunk: c, data: { lines: [] } as unknown as ParsedExtraction })));
    const merged = mergeChunkExtractions(empty);
    const res = resolveChunkedRead({ single: null, singleDev: null, merged, mergedDev: null, chunkCount: 6 });
    expect(res.best).toBeNull();
    expect(res.pagesReadNoLines).toBe(true);
    const message = pagesReadNoLinesMessage(res.pagesRead, 6);
    expect(message).not.toMatch(/ingen lesbare linjer/i);
    // Importen tolker dette som et ufullstendig AI-svar (kan prøves igjen), ikke som «ingen linjer».
    const outcome = extractionOutcome({ ai_status: "failed", ai_failure: { kind: "incomplete", message }, extracted: { lines: [] } });
    expect(outcome.kind).toBe("ai_failed");
    if (outcome.kind === "ai_failed") {
      expect(outcome.failure.systemic).toBe(false);
      expect(outcome.failure.message).toContain("leste 6 av 6 sider");
    }
  });

  it("leseren bruker svaret fra tomme sider og melder sidevarsler videre", () => {
    const ai = readFileSync("supabase/functions/extract-invoice-from-pdf/aiRead.ts", "utf8");
    const idx = readFileSync("supabase/functions/extract-invoice-from-pdf/index.ts", "utf8");
    expect(ai).toContain("data: r.best ?? r.lastParsed");
    expect(ai).toContain("resolveChunkedRead(");
    expect(ai).toContain("directChunkReason(");
    expect(idx).toContain("for (const ri of readIssues) sum.issues.push(ri);");
  });
});
