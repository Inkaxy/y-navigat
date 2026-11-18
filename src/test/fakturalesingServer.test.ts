import { describe, expect, it } from "vitest";
import { loadReadingContext, readingPrompt, runWithSelfCheck, type ReadingDb, type RpcResult } from "../../supabase/pending/functions/_shared/readingContext";
import { READING_SETTINGS_OFF } from "../../supabase/pending/functions/_shared/readingSettings";
import type { SelfCheckLine } from "../../supabase/pending/functions/_shared/selfCheck";

const db = (answers: Record<string, RpcResult>): ReadingDb & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    rpc: (fn) => { calls.push(fn); return Promise.resolve(answers[fn] ?? { data: null, error: { message: "missing", code: "PGRST202" } }); },
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  };
};
const ok = (data: unknown): RpcResult => ({ data, error: null });
const line = (issues: number): SelfCheckLine => ({ line_kind: "vare", sku: "1", description: "x", quantity: 1, unit_price: 1, total_amount: 1, read_issues: Array.from({ length: issues }, () => ({ code: "regn", message: "går ikke opp" })) });
const sum = (dev: number) => ({ lines_sum: 100 + dev, expected_excl_vat: 100, deviation_pct: dev, missing_amount: -dev });

describe("Serverkode: uten SQL eller med alt av = dagens lesing", () => {
  it("manglende RPC gir alt av og ingen flere kall", async () => {
    const d = db({});
    const ctx = await loadReadingContext(d, "le", "sup");
    expect(ctx.available).toBe(false);
    expect(ctx.settings).toEqual(READING_SETTINGS_OFF);
    expect(d.calls).toEqual(["rm_reading_settings"]);
    expect(readingPrompt(ctx, "ASKO", "tekst")).toEqual({ extraHint: null, examples: null, catalogItems: 0, profileUsed: false });
  });
  it("bare det som er på hentes", async () => {
    const d = db({ rm_reading_settings: ok({ catalog: true, revision: 1 }), rm_supplier_reading_catalog: ok([{ sku_norm: "299727", sku_printed: ["29 9727"], name: "ISTE CHAI 1L", aliases: [], package: null, base_unit: "l" }]) });
    const ctx = await loadReadingContext(d, "le", "sup");
    expect(d.calls.sort()).toEqual(["rm_reading_settings", "rm_supplier_reading_catalog"]);
    const p = readingPrompt(ctx, "ASKO", "29 9727 ISTE CHAI");
    expect(p.catalogItems).toBe(1);
    expect(p.examples).toBeNull();
  });
});

describe("Selvkontroll: aldri dårligere lesing", () => {
  it("av: bare én lesing", async () => {
    const r = await runWithSelfCheck({ settings: READING_SETTINGS_OFF, strongAvailable: true, read: async () => ({ data: "a", lines: [line(1)], sum: sum(10) }) });
    expect(r.path).toEqual(["første"]);
  });
  it("på: selvkontroll, så sterkere modell; beste beholdes", async () => {
    const seen: (string | null)[] = [];
    const answers = { "første": { d: "a", l: [line(1)], s: sum(10) }, selvkontroll: { d: "b", l: [line(2)], s: sum(20) }, sterkere_modell: { d: "c", l: [line(0)], s: sum(0.5) } };
    const r = await runWithSelfCheck({ settings: { ...READING_SETTINGS_OFF, self_check: true }, strongAvailable: true,
      read: async (p, fb) => { seen.push(fb); const a = answers[p]; return { data: a.d, lines: a.l, sum: a.s }; } });
    expect(r.path).toEqual(["første", "selvkontroll", "sterkere_modell"]);
    expect(r.best?.data).toBe("c");
    expect(seen[0]).toBeNull();
    expect(seen[1]).toMatch(/SELVKONTROLL/);
  });
  it("dårligere nytt forsøk erstatter ikke det første; feilet sterk modell beholder beste", async () => {
    const r = await runWithSelfCheck({ settings: { ...READING_SETTINGS_OFF, self_check: true }, strongAvailable: true,
      read: async (p) => (p === "første" ? { data: "a", lines: [line(1)], sum: sum(3) } : p === "selvkontroll" ? { data: "b", lines: [line(3)], sum: sum(30) } : null) });
    expect(r.best?.data).toBe("a");
    expect(r.attempts.map((a) => a.failed)).toEqual([false, false, true]);
  });
  it("god første lesing: ingen selvkontroll", async () => {
    const r = await runWithSelfCheck({ settings: { ...READING_SETTINGS_OFF, self_check: true }, strongAvailable: true, read: async () => ({ data: "a", lines: [line(0)], sum: sum(0) }) });
    expect(r.path).toEqual(["første"]);
  });
});
