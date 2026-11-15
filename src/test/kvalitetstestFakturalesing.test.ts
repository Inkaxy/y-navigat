import { describe, expect, it } from "vitest";
import { matchFasit, scoreFasitV2, scoreQuality, type FasitRow, type QualityLine } from "../../supabase/functions/_shared/qualityTest.ts";
import { QUALITY_TEST_SET, qualityTestEntry } from "../../supabase/functions/_shared/qualityTestSet.ts";
import { effectiveResult, estimateRunCostUsd, planConfigs, summarizeConfig, type ConfigCheck, type QualityResult } from "@/ravarer/lib/qualityTest";
import { readFileSync } from "node:fs";

const line = (o: Partial<QualityLine>): QualityLine => ({
  sku: null, description: null, line_kind: "vare", quantity: null, unit: "stk", unit_price: null, total_amount: null,
  package_size: null, package_unit: null, count_per_package: null, price_basis: null, discount_amount: null, page_number: 1, ...o,
});
const fasit = (o: Partial<FasitRow>): FasitRow => ({ sku: null, description: null, line_kind: "vare", quantity: null, unit_price: null, total_amount: null, ...o });

describe("testsettet", () => {
  it("har 10 fasit, 9 vanskelige og 3 uten linjer, uten duplikater", () => {
    expect(QUALITY_TEST_SET.filter((e) => e.role === "fasit")).toHaveLength(10);
    expect(QUALITY_TEST_SET.filter((e) => e.role === "vanskelig")).toHaveLength(9);
    expect(QUALITY_TEST_SET.filter((e) => e.role === "uten_linjer")).toHaveLength(3);
    expect(new Set(QUALITY_TEST_SET.map((e) => e.invoice_id)).size).toBe(22);
  });
  it("de tre uten linjer er fra tre ulike leverandører", () => {
    expect(new Set(QUALITY_TEST_SET.filter((e) => e.role === "uten_linjer").map((e) => e.supplier)).size).toBe(3);
  });
  it("inneholder alle vanskelige fakturaene Henrik nevnte", () => {
    const nr = QUALITY_TEST_SET.filter((e) => e.role === "vanskelig").map((e) => e.invoice_number).sort();
    expect(nr).toEqual(["136003762", "1501126", "1509234", "526301", "330685033", "330709218", "9041322972", "9041398810", "9204831293"].sort());
  });
  it("rollen avgjøres bare av testsettet", () => {
    expect(qualityTestEntry("dffd27f6-7f1b-4a3b-8c11-8f9cfa0ab95d")?.role).toBe("vanskelig");
    expect(qualityTestEntry("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("kobling mot fasit", () => {
  it("kobler på varenummer uten mellomrom og ellers på entydig likt beløp", () => {
    const read = [line({ sku: "50110", total_amount: 1100 }), line({ total_amount: 500 })];
    const f = [fasit({ sku: "5011 0", total_amount: 1100 }), fasit({ total_amount: 500 })];
    expect(matchFasit(read, f)).toEqual([{ f: 0, r: 0, by: "sku" }, { f: 1, r: 1, by: "belop" }]);
  });
  it("kobler ikke når beløpet er tvetydig", () => {
    const read = [line({ total_amount: 100 }), line({ total_amount: 100 })];
    expect(matchFasit(read, [fasit({ total_amount: 100 }), fasit({ total_amount: 100 })])).toEqual([]);
  });
  it("teller feil enhetspris og scorer ikke beløpet når beløpet ble brukt til kobling", () => {
    const s = scoreFasitV2([line({ quantity: 2, unit_price: 600, total_amount: 1182.04 })], [fasit({ quantity: 2, unit_price: 29.55, total_amount: 1182.04 })], "godkjent_lagret");
    expect(s.qty_ok).toBe(1);
    expect(s.price_ok).toBe(0);
    expect(s.amount_n).toBe(0);
    expect(s.errors.some((e) => e.includes("enhetspris"))).toBe(true);
  });
  it("feil lest varenummer teller som feil varenummer, men linjen kobles på beløp", () => {
    const s = scoreFasitV2([line({ sku: "5301", total_amount: 1130 })], [fasit({ sku: "5301 0", total_amount: 1130 })], "dokumentkontrollert");
    expect(s.sku_n).toBe(1);
    expect(s.sku_ok).toBe(0);
    expect(s.matched_by_amount).toBe(1);
  });
  it("teller pantlinjer fra fasit som funnet bare når de leses som egne pant/frakt/gebyr-linjer", () => {
    const s = scoreFasitV2([line({ sku: "P1", line_kind: "pant", total_amount: 24 })], [fasit({ sku: "P1", line_kind: "pant", total_amount: 24 }), fasit({ sku: "P2", line_kind: "pant", total_amount: 12 })], "godkjent_lagret");
    expect([s.fee_found, s.fee_expected]).toEqual([1, 2]);
  });
});

describe("målinger per faktura", () => {
  it("kreditnota ASKO 330685033 treffer kontrollsummen med motsatt fortegn", () => {
    const m = scoreQuality({ role: "vanskelig", lines: [line({ quantity: -1, unit_price: 3141.2, total_amount: -3141.2 })], totalAmount: 3612.38, totalVat: 471.18, isCredit: true, totalPages: 1, fasit: null });
    expect(m.sum.hit).toBe(true);
  });
  it("mva som mangler gir ukjent treff, aldri gjettet", () => {
    const m = scoreQuality({ role: "vanskelig", lines: [line({ quantity: 1, unit_price: 100, total_amount: 100 })], totalAmount: 14175.36, totalVat: null, isCredit: false, totalPages: 1, fasit: null });
    expect(m.sum.hit).toBeNull();
    expect(m.sum.unknown_reason).toBe("mva_mangler");
  });
  it("linjesum 12 % under er ikke treff", () => {
    const m = scoreQuality({ role: "vanskelig", lines: [line({ quantity: 1, unit_price: 4300, total_amount: 4300 })], totalAmount: 6100, totalVat: 1220, isCredit: false, totalPages: 1, fasit: null });
    expect(m.sum.hit).toBe(false);
  });
  it("teller regnestykket og linjer uten tall hver for seg", () => {
    const m = scoreQuality({ role: "uten_linjer", lines: [line({ quantity: 2, unit_price: 10, total_amount: 20 }), line({ quantity: 2, unit_price: 10, total_amount: 25 }), line({ total_amount: 5 })], totalAmount: null, totalVat: null, isCredit: false, totalPages: 1, fasit: null });
    expect(m.arithmetic).toMatchObject({ with_numbers: 2, ok: 1, missing_numbers: 1 });
  });
  it("viser om siste side har linjer", () => {
    const lines = [line({ page_number: 1, total_amount: 1 }), line({ page_number: 2, total_amount: 1 })];
    expect(scoreQuality({ role: "vanskelig", lines, totalAmount: null, totalVat: null, isCredit: false, totalPages: 3, fasit: null }).pages).toMatchObject({ with_lines: [1, 2], last_page_has_lines: false });
  });
});

const check = (o: Partial<ConfigCheck>): ConfigCheck => ({ configId: "a", provider: "openai", model: "gpt-6-luna", isActive: false, updatedAt: "2026-11-13", status: "ok", message: "", ...o });

describe("plan og oppsummering", () => {
  it("tar ut oppsett uten virkende nøkkel og tester samme modell én gang", () => {
    const p = planConfigs([
      check({ configId: "sol-old", model: "gpt-6.1-sol", updatedAt: "2026-11-13T13:35:21" }),
      check({ configId: "sol-new", model: "gpt-6.1-sol", updatedAt: "2026-11-13T13:35:46" }),
      check({ configId: "luna", isActive: true }),
      check({ configId: "4o", model: "gpt-4o", status: "auth", message: "avvist" }),
    ]);
    expect(p.run.map((r) => r.check.configId)).toEqual(["luna", "sol-new"]);
    expect(p.skipped.map((s) => s.check.configId).sort()).toEqual(["4o", "sol-old"]);
  });
  it("overslaget bruker kjente satser og er ukjent for ukjent modell", () => {
    expect(estimateRunCostUsd([{ provider: "openai", model: "gpt-6-luna" }], 1).total).toBeCloseTo(((12000 * 0.1 + 3000 * 0.5) / 1e6) * 1.3, 8);
    expect(estimateRunCostUsd([{ provider: "openai", model: "ukjent" }], 1).total).toBeNull();
  });

  const res = (o: Partial<QualityResult>): QualityResult => ({
    invoiceId: QUALITY_TEST_SET[0].invoice_id, invoiceNumber: null, model: "m", status: "ok", statusLabel: "Lest", error: null,
    usage: { input: 1, output: 1, cached: null, reasoning: null }, costUsd: 0.01, latencyMs: 2000, lineCount: 1, storedLineCount: null,
    checkCount: 0, checkCounts: {}, fasit: null, raw: null, configId: "c", configLabel: "c", mode: "enkelt", totalPages: 2,
    chunkSuggested: null, chunked: null, fasitStatus: null, metrics: null, ...o,
  });
  const metrics = (dev: number, hit: boolean) => ({
    role: "fasit" as const, lineCount: 1, sum: { linesSum: 1, expectedExcl: 1, deviationPct: dev, missing: 0, hit, unknownReason: null },
    arithmetic: { withNumbers: 1, ok: 1, missingNumbers: 0, failing: [] }, fees: { pant: 0, frakt: 0, gebyr: 0, rabatt: 0 },
    pages: { total: 2, withLines: [1], lastPageHasLines: false }, fasit: null,
  });
  it("sidebolker brukes bare når alle bolker lyktes og summen kom nærmere", () => {
    const single = res({ metrics: metrics(-40, false) });
    const chunkOk = res({ mode: "sidebolker", chunked: { chunks: 2, complete: true }, metrics: metrics(0.1, true) });
    const chunkHalf = res({ mode: "sidebolker", chunked: { chunks: 2, complete: false }, metrics: metrics(0.1, true) });
    expect(effectiveResult(single, chunkOk)).toBe(chunkOk);
    expect(effectiveResult(single, chunkHalf)).toBe(single);
  });
  it("oppsummerer kostnad over alle kall og kontrollsumtreff på resultatet produksjonen ville brukt", () => {
    const s = summarizeConfig("c", "c", [
      res({ metrics: metrics(-40, false), chunkSuggested: "svaret ble kuttet av maks svarlengde" }),
      res({ mode: "sidebolker", costUsd: 0.02, chunked: { chunks: 2, complete: true }, metrics: metrics(0.1, true) }),
    ]);
    expect(s.costTotalUsd).toBeCloseTo(0.03, 8);
    expect(s.sumHit).toEqual({ ok: 1, n: 1 });
    expect(s.singleCut).toBe(1);
    expect(s.chunkedHit).toEqual({ ok: 1, n: 1 });
  });
});

describe("rammer i serverkoden", () => {
  const src = readFileSync("supabase/functions/invoice-model-eval/index.ts", "utf8") + readFileSync("supabase/functions/invoice-model-eval/quality.ts", "utf8");
  it("skriver bare til bruksloggen, aldri til fakturaer, linjer eller oppsett", () => {
    expect(src).not.toMatch(/from\("(invoices|invoice_lines|ai_provider_config|raw_materials)"\)\s*\.(update|insert|upsert|delete)/);
    expect(src.match(/\.(update|insert|upsert|delete)\(/g)).toEqual([".update("]);
    expect(src).toContain('from("ai_usage_log").update(');
  });
});
