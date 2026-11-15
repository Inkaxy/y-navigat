// Kvalitetstest av fakturalesing på tvers av lagrede AI-oppsett (AI-tjenester › Kvalitetstest før gjenlesing).
// Strenge lesere for svarene fra invoice-model-eval og ren oppsummering per oppsett. Ukjent form = ukjent, aldri 0.
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { parseEvalOutcome, type EvalOutcome } from "@/ravarer/lib/modelEval";
import { estimateCostUsd } from "../../../supabase/functions/_shared/ai-providers.ts";
import { QUALITY_TEST_SET, type QualityRole } from "../../../supabase/functions/_shared/qualityTestSet.ts";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === "number" && Number.isFinite(x)) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export interface ConfigCheck { configId: string; provider: string; model: string; isActive: boolean; updatedAt: string; status: string; message: string }

export function parseConfigChecks(data: unknown): ConfigCheck[] {
  if (!isRec(data) || !Array.isArray(data.configs)) throw new Error("Uventet svar fra nøkkelsjekken.");
  return data.configs.map((c) => {
    if (!isRec(c) || !str(c.config_id) || !str(c.provider) || !str(c.model) || typeof c.is_active !== "boolean" || !str(c.status)) throw new Error("Uventet rad i nøkkelsjekken.");
    return { configId: c.config_id as string, provider: c.provider as string, model: c.model as string, isActive: c.is_active, updatedAt: str(c.updated_at) ?? "", status: c.status as string, message: str(c.message) ?? "" };
  });
}

export interface PlannedConfig { check: ConfigCheck; label: string }
export interface SkippedConfig { check: ConfigCheck; reason: string }

export const configLabel = (c: Pick<ConfigCheck, "provider" | "model">) => `${c.provider} / ${c.model}`;

/** Bare oppsett med virkende nøkkel tas med; samme leverandør+modell testes én gang (aktiv eller nyeste først). */
export function planConfigs(checks: readonly ConfigCheck[]): { run: PlannedConfig[]; skipped: SkippedConfig[] } {
  const run: PlannedConfig[] = [];
  const skipped: SkippedConfig[] = [];
  const order = [...checks].sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.updatedAt.localeCompare(a.updatedAt));
  for (const c of order) {
    if (c.status !== "ok") { skipped.push({ check: c, reason: c.message || "Nøkkelen virker ikke" }); continue; }
    if (run.some((r) => r.check.provider === c.provider && r.check.model === c.model)) { skipped.push({ check: c, reason: "Samme leverandør og modell som et annet oppsett; testes én gang" }); continue; }
    run.push({ check: c, label: configLabel(c) });
  }
  return { run, skipped };
}

/** Grovt overslag før start: typisk forbruk per faktura (OpenAI ≈ 12 000 inn / 3 000 ut; Anthropic leser PDF-sider som bilder). */
export function estimateRunCostUsd(models: readonly { provider: string; model: string }[], invoices = QUALITY_TEST_SET.length): { perConfig: Array<number | null>; total: number | null; calls: number } {
  const perConfig = models.map((m) => {
    const one = estimateCostUsd(m.model, m.provider === "anthropic" ? 25_000 : 12_000, 3_000);
    return one == null ? null : one * invoices * 1.3; // +30 % for sidebolker på lange fakturaer
  });
  const known = perConfig.filter((x): x is number => x != null);
  return { perConfig, total: known.length === perConfig.length ? known.reduce((s, x) => s + x, 0) : null, calls: models.length * invoices };
}

export interface FasitMetrics {
  source: string; expected: number; read: number; matchedBySku: number; matchedByAmount: number; unmatchedExpected: number; extraRead: number;
  skuN: number; skuOk: number; qtyN: number; qtyOk: number; priceN: number; priceOk: number; amountN: number; amountOk: number;
  feeExpected: number; feeFound: number; errors: string[];
}
export interface QualityMetricsV {
  role: QualityRole; lineCount: number;
  sum: { linesSum: number; expectedExcl: number | null; deviationPct: number | null; missing: number | null; hit: boolean | null; unknownReason: string | null };
  arithmetic: { withNumbers: number; ok: number; missingNumbers: number; failing: string[] };
  fees: { pant: number; frakt: number; gebyr: number; rabatt: number };
  pages: { total: number | null; withLines: number[]; lastPageHasLines: boolean | null };
  fasit: FasitMetrics | null;
}

const ROLES: readonly string[] = ["fasit", "vanskelig", "uten_linjer"];
export function parseQualityMetrics(v: unknown): QualityMetricsV | null {
  if (!isRec(v) || !ROLES.includes(String(v.role)) || !isRec(v.sum) || !isRec(v.arithmetic) || !isRec(v.fees) || !isRec(v.pages)) return null;
  const s = v.sum, a = v.arithmetic, fe = v.fees, p = v.pages;
  const lineCount = num(v.line_count), linesSum = num(s.lines_sum), wn = num(a.with_numbers), ok = num(a.ok), mn = num(a.missing_numbers);
  if (lineCount == null || linesSum == null || wn == null || ok == null || mn == null) return null;
  let fasit: FasitMetrics | null = null;
  if (isRec(v.fasit)) {
    const f = v.fasit;
    const k = ["expected", "read", "matched_by_sku", "matched_by_amount", "unmatched_expected", "extra_read", "sku_n", "sku_ok", "qty_n", "qty_ok", "price_n", "price_ok", "amount_n", "amount_ok", "fee_expected", "fee_found"].map((x) => num(f[x]));
    if (k.some((x) => x == null)) return null;
    const [expected, read, matchedBySku, matchedByAmount, unmatchedExpected, extraRead, skuN, skuOk, qtyN, qtyOk, priceN, priceOk, amountN, amountOk, feeExpected, feeFound] = k as number[];
    fasit = { source: str(f.source) ?? "ukjent", expected, read, matchedBySku, matchedByAmount, unmatchedExpected, extraRead, skuN, skuOk, qtyN, qtyOk, priceN, priceOk, amountN, amountOk, feeExpected, feeFound, errors: strs(f.errors) };
  }
  return {
    role: v.role as QualityRole, lineCount,
    sum: { linesSum, expectedExcl: num(s.expected_excl), deviationPct: num(s.deviation_pct), missing: num(s.missing), hit: typeof s.hit === "boolean" ? s.hit : null, unknownReason: str(s.unknown_reason) },
    arithmetic: { withNumbers: wn, ok, missingNumbers: mn, failing: strs(a.failing) },
    fees: { pant: num(fe.pant) ?? 0, frakt: num(fe.frakt) ?? 0, gebyr: num(fe.gebyr) ?? 0, rabatt: num(fe.rabatt) ?? 0 },
    pages: { total: num(p.total), withLines: nums(p.with_lines), lastPageHasLines: typeof p.last_page_has_lines === "boolean" ? p.last_page_has_lines : null },
    fasit,
  };
}

export interface QualityResult extends EvalOutcome {
  configId: string; configLabel: string; mode: "enkelt" | "sidebolker";
  totalPages: number | null; chunkSuggested: string | null; chunked: { chunks: number; complete: boolean } | null;
  fasitStatus: string | null; metrics: QualityMetricsV | null;
}

export function parseQualityResult(data: unknown, invoiceId: string, cfg: PlannedConfig, mode: "enkelt" | "sidebolker"): QualityResult {
  const base = parseEvalOutcome(data, invoiceId, cfg.check.model);
  const o = isRec(data) ? data : {};
  const qt = isRec(o.quality_test) ? o.quality_test : null;
  const ch = isRec(o.chunked) ? o.chunked : null;
  return {
    ...base, configId: cfg.check.configId, configLabel: cfg.label, mode,
    totalPages: num(o.total_pages), chunkSuggested: str(o.chunk_suggested),
    chunked: ch && num(ch.chunks) != null && typeof ch.complete === "boolean" ? { chunks: num(ch.chunks)!, complete: ch.complete } : null,
    fasitStatus: qt ? str(qt.fasit_status) : null,
    metrics: qt ? parseQualityMetrics(qt.metrics) : null,
  };
}

export async function invokeQualityRead(invoiceId: string, cfg: PlannedConfig, mode: "enkelt" | "sidebolker"): Promise<QualityResult> {
  const body = { invoice_id: invoiceId, config_id: cfg.check.configId, ...(mode === "sidebolker" ? { mode } : {}) };
  const { data, error } = await supabase.functions.invoke("invoice-model-eval", { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const b: unknown = await error.context.json().catch(() => null);
      return parseQualityResult(b ?? { error: { code: "http", message: "Ukjent feil" } }, invoiceId, cfg, mode);
    }
    return parseQualityResult({ error: { code: "nettverk", message: "Svaret kom ikke fram" } }, invoiceId, cfg, mode);
  }
  return parseQualityResult(data, invoiceId, cfg, mode);
}

export async function invokeConfigCheck(): Promise<ConfigCheck[]> {
  const { data, error } = await supabase.functions.invoke("invoice-model-eval", { body: { action: "check_configs" } });
  if (error) throw new Error("Nøkkelsjekken svarte ikke. Prøv igjen.");
  return parseConfigChecks(data);
}

/**
 * Resultatet produksjonen ville brukt for én faktura: sidebolker bare når alle bolker lyktes og linjesummen
 * kom nærmere kontrollsummen (samme regel som fakturaleseren), ellers enkeltlesingen.
 */
export function effectiveResult(single: QualityResult | null, chunk: QualityResult | null): QualityResult | null {
  if (!chunk || chunk.status !== "ok" || !chunk.chunked?.complete || !chunk.metrics) return single;
  if (!single || single.status !== "ok" || !single.metrics || single.metrics.lineCount === 0) return chunk;
  const a = single.metrics.sum.deviationPct, b = chunk.metrics.sum.deviationPct;
  return a == null || b == null || Math.abs(b) < Math.abs(a) ? chunk : single;
}

export interface Ratio { ok: number; n: number }
export interface ConfigSummary {
  configId: string; label: string; invoices: number; readOk: number; failed: Array<{ invoice: string; status: string }>;
  sumHit: Ratio; sumUnknown: number;
  fasitInvoices: number; lineCountExact: Ratio; linesExpected: number; linesRead: number;
  sku: Ratio; qty: Ratio; price: Ratio; amount: Ratio; arithmetic: Ratio;
  feeFasit: Ratio; feeLinesFound: number;
  multiPage: number; singleCut: number; lastPageCovered: Ratio; chunkedHit: Ratio;
  latencyAvgS: number | null; costPerInvoiceUsd: number | null; costTotalUsd: number; costUnknownCalls: number;
}

const add = (r: Ratio, ok: number, n: number) => { r.ok += ok; r.n += n; };

export function summarizeConfig(configId: string, label: string, results: readonly QualityResult[]): ConfigSummary {
  const mine = results.filter((r) => r.configId === configId);
  const s: ConfigSummary = {
    configId, label, invoices: 0, readOk: 0, failed: [], sumHit: { ok: 0, n: 0 }, sumUnknown: 0,
    fasitInvoices: 0, lineCountExact: { ok: 0, n: 0 }, linesExpected: 0, linesRead: 0,
    sku: { ok: 0, n: 0 }, qty: { ok: 0, n: 0 }, price: { ok: 0, n: 0 }, amount: { ok: 0, n: 0 }, arithmetic: { ok: 0, n: 0 },
    feeFasit: { ok: 0, n: 0 }, feeLinesFound: 0, multiPage: 0, singleCut: 0, lastPageCovered: { ok: 0, n: 0 }, chunkedHit: { ok: 0, n: 0 },
    latencyAvgS: null, costPerInvoiceUsd: null, costTotalUsd: 0, costUnknownCalls: 0,
  };
  const lat: number[] = [];
  const perInvoiceCost = new Map<string, number>();
  for (const r of mine) {
    if (r.costUsd != null) { s.costTotalUsd += r.costUsd; perInvoiceCost.set(r.invoiceId, (perInvoiceCost.get(r.invoiceId) ?? 0) + r.costUsd); }
    else if (r.usage.input != null || r.status === "ok") s.costUnknownCalls++;
  }
  for (const inv of QUALITY_TEST_SET) {
    const single = mine.find((r) => r.invoiceId === inv.invoice_id && r.mode === "enkelt") ?? null;
    const chunk = mine.find((r) => r.invoiceId === inv.invoice_id && r.mode === "sidebolker") ?? null;
    if (!single && !chunk) continue;
    s.invoices++;
    const lt = (single?.latencyMs ?? 0) + (chunk?.latencyMs ?? 0);
    if (single?.latencyMs != null || chunk?.latencyMs != null) lat.push(lt / 1000);
    const eff = effectiveResult(single, chunk);
    const m = eff?.status === "ok" ? eff.metrics : null;
    if (!m) { s.failed.push({ invoice: `${inv.supplier} ${inv.invoice_number}`, status: eff?.statusLabel ?? "ikke lest" }); continue; }
    s.readOk++;
    if (m.sum.hit == null) s.sumUnknown++; else add(s.sumHit, m.sum.hit ? 1 : 0, 1);
    add(s.arithmetic, m.arithmetic.ok, m.arithmetic.withNumbers);
    s.feeLinesFound += m.fees.pant + m.fees.frakt + m.fees.gebyr;
    if (m.fasit) {
      s.fasitInvoices++;
      add(s.lineCountExact, m.fasit.read === m.fasit.expected ? 1 : 0, 1);
      s.linesExpected += m.fasit.expected; s.linesRead += m.fasit.read;
      add(s.sku, m.fasit.skuOk, m.fasit.skuN); add(s.qty, m.fasit.qtyOk, m.fasit.qtyN);
      add(s.price, m.fasit.priceOk, m.fasit.priceN); add(s.amount, m.fasit.amountOk, m.fasit.amountN);
      add(s.feeFasit, m.fasit.feeFound, m.fasit.feeExpected);
    }
    const pages = single?.totalPages ?? chunk?.totalPages ?? null;
    if (pages != null && pages >= 2) {
      s.multiPage++;
      if (single && (single.status === "incomplete" || (single.chunkSuggested ?? "").includes("kuttet"))) s.singleCut++;
      const sm = single?.status === "ok" ? single.metrics : null;
      if (sm && sm.pages.lastPageHasLines != null) add(s.lastPageCovered, sm.pages.lastPageHasLines ? 1 : 0, 1);
      const cm = chunk?.status === "ok" ? chunk.metrics : null;
      if (cm && cm.sum.hit != null) add(s.chunkedHit, cm.sum.hit ? 1 : 0, 1);
    }
  }
  s.latencyAvgS = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null;
  s.costPerInvoiceUsd = perInvoiceCost.size ? [...perInvoiceCost.values()].reduce((a, b) => a + b, 0) / perInvoiceCost.size : null;
  return s;
}

/** «7 av 9 (78 %)», eller «–» når ingenting kunne måles. */
export function ratioText(r: Ratio): string {
  if (r.n === 0) return "–";
  return `${r.ok.toLocaleString("nb-NO")} av ${r.n.toLocaleString("nb-NO")} (${Math.round((r.ok / r.n) * 100).toLocaleString("nb-NO")} %)`;
}
