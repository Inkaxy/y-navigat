import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  classifyAiFailure, isAiFailureText, lastCallFailedSystemically, shouldSendReadingAlert, AI_FAILURE_PREFIX,
} from "../../supabase/functions/_shared/aiFailure";
import { AiCallError } from "../../supabase/functions/_shared/ai-providers";
import { computeLinesSum, expectedExclVat } from "../../supabase/functions/_shared/lines-sum";
import { resolveHeaderVat } from "../../supabase/functions/tripletex-import-invoice-lines/ledger-account";
import { extractionOutcome } from "../../supabase/functions/tripletex-import-invoice-lines/extraction-outcome";
import { planLineExtractionFailure } from "../../supabase/functions/tripletex-import-invoice-lines/failure-plan";
import { applyNumberCheck, type CheckLine } from "../../supabase/functions/_shared/numberCheck";
import { chunkReason, mergeChunkExtractions, planPageChunks, maxPageOf } from "../../supabase/functions/_shared/chunkedExtraction";
import { checkSum } from "../../supabase/functions/_shared/invoiceExtraction";
import { invoiceReadingHealth } from "@/ravarer/lib/invoiceReadingHealth";

const row = (created_at: string, success: boolean, error_message: string | null = null) => ({ created_at, success, error_message });

describe("A – AI-feil klassifiseres og blir aldri «ingen linjer»", () => {
  it("avvist/ugyldig nøkkel er autentiseringsfeil som stopper kjøringen", () => {
    for (const t of ["OpenAI 401: Your API key has been invalidated", "OpenAI 401: Incorrect API key provided: sk-…"]) {
      const f = classifyAiFailure(new Error(t), "openai");
      expect(f.kind).toBe("auth");
      expect(f.systemic).toBe(true);
      expect(f.message).toBe("AI-tjenesten avviste nøkkelen (OpenAI 401). Legg inn ny nøkkel under AI-tjenester.");
    }
  });
  it("kvote, nede, nettverk er systemiske; tidsavbrudd og kuttet svar gjelder fakturaen", () => {
    expect(classifyAiFailure(new Error("OpenAI 429: insufficient_quota")).kind).toBe("quota");
    expect(classifyAiFailure(new Error("Anthropic 529: overloaded")).kind).toBe("unavailable");
    expect(classifyAiFailure(new TypeError("error sending request: connection reset")).kind).toBe("network");
    const t = classifyAiFailure(new AiCallError("timeout", "AI-tjenesten svarte ikke innen 90 s"));
    expect(t.kind).toBe("timeout"); expect(t.systemic).toBe(false);
    const c = classifyAiFailure(new AiCallError("incomplete", "Svaret ble ufullstendig (max_tokens)"));
    expect(c.kind).toBe("incomplete"); expect(c.systemic).toBe(false);
  });
  it("egne norske meldinger klassifiseres likt når de leses tilbake fra loggen", () => {
    for (const k of ["auth", "quota", "network", "unavailable"] as const) {
      const msg = classifyAiFailure(new Error(k === "auth" ? "OpenAI 401: x" : k === "quota" ? "OpenAI 429: x" : k === "network" ? "failed to fetch" : "OpenAI 503: x"), "openai").message;
      expect(msg.startsWith(AI_FAILURE_PREFIX)).toBe(true);
      expect(classifyAiFailure(`Forhåndssjekk: ${msg}`).kind).toBe(k);
    }
    expect(isAiFailureText("Forsøk 2/3: AI-tjenesten avviste nøkkelen (OpenAI 401).")).toBe(true);
    expect(isAiFailureText("PDF-en ga ingen lesbare linjer")).toBe(false);
  });
  it("importen tolker svaret: eldre leser som før, AI-feil som feil, tomt svar som lest", () => {
    expect(extractionOutcome({ extracted: { lines: [] } })).toEqual({ kind: "read", zeroLines: true });
    const f = extractionOutcome({ ai_status: "failed", ai_failure: { kind: "auth", systemic: true, httpStatus: 401, provider: "openai", message: "AI-tjenesten avviste nøkkelen (OpenAI 401)." }, extracted: { lines: [] } });
    expect(f.kind).toBe("ai_failed");
    if (f.kind === "ai_failed") { expect(f.failure.systemic).toBe(true); expect(f.failure.message).toContain("avviste nøkkelen"); }
    expect(extractionOutcome({ ai_status: "not_configured" }).kind).toBe("ai_failed");
    expect(extractionOutcome({ ai_status: "no_lines", extracted: { lines: [] } })).toEqual({ kind: "read", zeroLines: true });
  });
  it("tjenestefeil teller ikke som forsøk og fakturaen blir liggende i køen", () => {
    const p = planLineExtractionFailure({ attempts: 1, message: "AI-tjenesten avviste nøkkelen", status: "imported", pdfFail: false, aiSystemic: true });
    expect(p.patch.line_extraction_status).toBe("pending");
    expect(p.patch.release_attempt).toBe(true);
    expect(p.gaveOpp).toBe(false);
    expect(p.patch.status).toBeUndefined();
    const ex = planLineExtractionFailure({ attempts: 3, message: "AI-tjenesten avviste nøkkelen", status: "imported", pdfFail: false, aiSystemic: true });
    expect(ex.patch.line_extraction_status).toBe("failed");
  });
  it("importen tar én faktura om gangen og stopper ved første tjenestefeil", () => {
    const src = readFileSync("supabase/functions/tripletex-import-invoice-lines/index.ts", "utf8");
    expect(src).toContain("p_limit: 1,");
    expect(src).toContain("!stopped");
    expect(src).toContain('if (outcome.kind === "ai_failed")');
  });
});

describe("B – varsel når lesingen stopper", () => {
  const auth = "OpenAI 401: Incorrect API key provided";
  it("e-post først etter to tjenestefeil på rad, høyst én per døgn for samme feil", () => {
    const now = Date.parse("2026-11-13T12:00:00Z");
    expect(shouldSendReadingAlert([row("2026-11-13T11:00:00Z", false, auth)], null, now)).toBeNull();
    expect(shouldSendReadingAlert([row("2026-11-13T11:00:00Z", false, auth), row("2026-11-13T10:00:00Z", true)], null, now)).toBeNull();
    const two = [row("2026-11-13T11:00:00Z", false, auth), row("2026-11-13T10:00:00Z", false, auth)];
    expect(shouldSendReadingAlert(two, null, now)?.kind).toBe("auth");
    expect(shouldSendReadingAlert(two, { created_at: "2026-11-13T01:00:00Z", kind: "auth" }, now)).toBeNull();
    expect(shouldSendReadingAlert(two, { created_at: "2026-11-12T11:59:00Z", kind: "auth" }, now)?.kind).toBe("auth");
    expect(shouldSendReadingAlert(two, { created_at: "2026-11-13T11:30:00Z", kind: "quota" }, now)?.kind).toBe("auth");
  });
  it("forhåndssjekk bare når siste kall feilet på tjenesten", () => {
    expect(lastCallFailedSystemically([row("x", false, auth)])?.kind).toBe("auth");
    expect(lastCallFailedSystemically([row("x", false, "invalid_json")])).toBeNull();
    expect(lastCallFailedSystemically([row("x", true)])).toBeNull();
  });
  it("lesestatus: feiler siden første feil i rekken, med siste vellykkede lesing", () => {
    const h = invoiceReadingHealth({
      usage: [row("2026-11-11T08:00:00Z", false, auth), row("2026-10-20T07:00:00Z", false, "OpenAI 401: Your API key has been invalidated"), row("2026-10-19T15:00:00Z", true)],
      lastSuccessAt: "2026-10-19T15:00:00Z", aiErrorInvoices: [],
    });
    expect(h.state).toBe("failing");
    if (h.state === "failing") { expect(h.failingSince).toBe("2026-10-20T07:00:00Z"); expect(h.failedCalls).toBe(2); expect(h.lastSuccessAt).toBe("2026-10-19T15:00:00Z"); }
    expect(invoiceReadingHealth({ usage: [row("x", true)], lastSuccessAt: null, aiErrorInvoices: [] }).state).toBe("ok");
    expect(invoiceReadingHealth({ usage: null, lastSuccessAt: null, aiErrorInvoices: null }).state).toBe("unknown");
    expect(invoiceReadingHealth({ usage: null, lastSuccessAt: null, aiErrorInvoices: [] }).state).toBe("unknown");
    const inv = invoiceReadingHealth({ usage: [], lastSuccessAt: null, aiErrorInvoices: [{ line_extraction_error: "AI-tjenesten avviste nøkkelen (OpenAI 401).", line_extraction_at: "2026-11-11T08:00:00Z" }] });
    expect(inv.state).toBe("failing");
  });
  it("appens kopi av feilklassifiseringen er byte-identisk med serverens", () => {
    expect(readFileSync("src/fakturaer/lib/aiFailure.ts", "utf8")).toBe(readFileSync("supabase/functions/_shared/aiFailure.ts", "utf8"));
  });
});

describe("D – kreditnota med motsatt fortegn", () => {
  it("ASKO 330685033: total 3612, mva 471, linjer -3141,2 stemmer", () => {
    const r = computeLinesSum({ lineTotals: [-3141.2], totalAmount: 3612, totalVat: 471, isCredit: true });
    expect(r.lines_sum_status).toBe("ok");
    expect(Math.abs(r.lines_sum_variance_pct ?? 99)).toBeLessThan(0.1);
    expect(computeLinesSum({ lineTotals: [-3141.2], totalAmount: -3612, totalVat: 471, isCredit: true }).lines_sum_status).toBe("ok");
    expect(computeLinesSum({ lineTotals: [-3141.2], totalAmount: -3612, totalVat: -471, isCredit: true }).lines_sum_status).toBe("ok");
  });
  it("reelle avvik fanges fortsatt", () => {
    expect(computeLinesSum({ lineTotals: [-1000], totalAmount: 3612, totalVat: 471, isCredit: true }).lines_sum_status).toBe("mismatch");
    // Vanlig faktura: motsatt fortegn er et reelt avvik.
    expect(computeLinesSum({ lineTotals: [-3141.2], totalAmount: 3612, totalVat: 471 }).lines_sum_status).toBe("mismatch");
    expect(computeLinesSum({ lineTotals: [3141.2], totalAmount: 3612, totalVat: 471 }).lines_sum_status).toBe("ok");
  });
  it("kontrollsum eks. mva trekker mva i totalens retning på kreditnota", () => {
    expect(expectedExclVat(-3612, 471, true)).toBe(-3141);
    expect(expectedExclVat(3612, 471, true)).toBe(3141);
    expect(expectedExclVat(3612, 471, false)).toBe(3141);
    expect(expectedExclVat(3612, null, true)).toBeNull();
  });
  it("leserens sumkontroll godtar kreditnota med motsatt fortegn", () => {
    const s = checkSum([{ total_amount: -3141.2 }] as never, 3141, null, null, true);
    expect(Math.abs(s.deviation_pct ?? 99)).toBeLessThan(0.1);
  });
});

describe("E – mva 0 på fakturahodet", () => {
  it("0 erstattes av bilagets mva når posteringene viser mva", () => {
    expect(resolveHeaderVat(0, 2628, 20148)).toEqual({ vat: 2628, fromPostings: true, zeroReplaced: true });
  });
  it("0 uten mva i bilaget er en gyldig 0; null bruker bilaget som før", () => {
    expect(resolveHeaderVat(0, null, 20148)).toEqual({ vat: 0, fromPostings: false, zeroReplaced: false });
    expect(resolveHeaderVat(0, 0, 20148)).toEqual({ vat: 0, fromPostings: false, zeroReplaced: false });
    expect(resolveHeaderVat(null, 471, 3612)).toEqual({ vat: 471, fromPostings: true, zeroReplaced: false });
    expect(resolveHeaderVat(500, 471, 3612)).toEqual({ vat: 500, fromPostings: false, zeroReplaced: false });
  });
  it("bilagets mva brukes aldri når den er like stor som totalen", () => {
    expect(resolveHeaderVat(0, 20148, 20148).fromPostings).toBe(false);
  });
});

const line = (quantity: number, unit_price: number, total_amount: number, unit = "kg"): CheckLine => ({
  quantity, unit, unit_price, total_amount, package_size: null, package_unit: null, count_per_package: null,
  price_basis: null, discount_amount: null, line_kind: "vare", read_issues: [],
});

describe("H – tallkontroll uten AI (PALS 526301)", () => {
  const pals = [line(10000, 110, 110000), line(10000, 113, 113000), line(11340, 86, 97524), line(396000, 52, 20592), line(25000, 79.5, 1987.5)];
  it("entydige tusenskille-/desimalfeil rettes når summen da stemmer med kontrollsummen", () => {
    const r = applyNumberCheck(pals, 25784.74, false);
    expect(r.corrected.length).toBe(5);
    expect(r.lines.map((l) => l.quantity)).toEqual([10, 10, 11.34, 396, 25]);
    const sum = r.lines.reduce((s, l) => s + (l.total_amount ?? 0), 0);
    expect(Math.abs(sum - 25784.74)).toBeLessThan(0.5);
    expect(r.invoiceIssue?.code).toBe("tall_rettet");
  });
  it("ingen retting uten kjent kontrollsum, og beløp skaleres aldri for å treffe summen", () => {
    expect(applyNumberCheck(pals, null, false).corrected).toEqual([]);
    // Linjer som allerede går opp, men ikke treffer kontrollsummen: ingenting endres.
    const ok = [line(10, 110, 1100), line(10, 113, 1130)];
    const r = applyNumberCheck(ok, 22300, false);
    expect(r.corrected).toEqual([]);
    expect(r.lines.map((l) => l.total_amount)).toEqual([1100, 1130]);
  });
});

describe("G – lange fakturaer leses i sidebolker", () => {
  it("sidebolker dekker alle sider uten overlapp", () => {
    expect(planPageChunks(1)).toEqual([{ from: 1, to: 1 }]);
    const c = planPageChunks(20);
    expect(c.length).toBeLessThanOrEqual(8);
    expect(c[0].from).toBe(1); expect(c[c.length - 1].to).toBe(20);
    for (let i = 1; i < c.length; i++) expect(c[i].from).toBe(c[i - 1].to + 1);
  });
  it("deles bare når svaret ble kuttet eller mye mangler på en flersidig faktura", () => {
    expect(chunkReason({ truncated: true, totalPages: 1, linesSum: null, expectedExcl: null, maxPageSeen: null })).toBeNull();
    expect(chunkReason({ truncated: true, totalPages: 3, linesSum: null, expectedExcl: null, maxPageSeen: null })).toContain("kuttet");
    expect(chunkReason({ truncated: false, totalPages: 4, linesSum: 4470.8, expectedExcl: 125846, maxPageSeen: 1 })).toContain("side 1 av 4");
    expect(chunkReason({ truncated: false, totalPages: 4, linesSum: 120000, expectedExcl: 125846, maxPageSeen: 4 })).toBeNull();
  });
  it("sammensetting følger sideorden, normaliserer sidenummer og krever alle bolker", () => {
    const m = mergeChunkExtractions([
      { chunk: { from: 3, to: 4 }, data: { total_amount: 100, field_confidence: { total_amount: 0.9 }, lines: [{ description: "C", page_number: 1 }] } as never },
      { chunk: { from: 1, to: 2 }, data: { supplier_name: "Drammen Papir", total_amount: null, field_confidence: { total_amount: 0.5 }, lines: [{ description: "A", page_number: 1 }, { description: "B", page_number: 2 }] } as never },
    ]);
    expect(m.complete).toBe(true);
    expect(m.data.lines.map((l) => l.description)).toEqual(["A", "B", "C"]);
    expect(maxPageOf(m.data.lines)).toBe(3);
    expect(m.data.supplier_name).toBe("Drammen Papir");
    expect(m.data.total_amount).toBe(100);
    const bad = mergeChunkExtractions([{ chunk: { from: 1, to: 2 }, data: null }, { chunk: { from: 3, to: 4 }, data: { lines: [] } as never }]);
    expect(bad.complete).toBe(false);
    expect(bad.failedChunks).toEqual([{ from: 1, to: 2 }]);
  });
});

describe("F – avgifter i oppsummeringen leses som egne linjer", () => {
  it("prompten ber om avgift/gebyr/frakt/pant fra oppsummeringen og alle sider", async () => {
    const { INVOICE_EXTRACTION_SYSTEM_PROMPT } = await import("../../supabase/functions/_shared/invoiceExtractionPrompt");
    expect(INVOICE_EXTRACTION_SYSTEM_PROMPT).toMatch(/oppsummeringen nederst/);
    expect(INVOICE_EXTRACTION_SYSTEM_PROMPT).toMatch(/alle sider/i);
  });
});

describe("PENDING-SQL – forutsetninger og minimale tekstbytter", () => {
  const credit = readFileSync("supabase/pending/20261113_lines_sum_credit_vat.PENDING.sql", "utf8");
  const release = readFileSync("supabase/pending/20261113_line_extraction_release_requeue.PENDING.sql", "utf8");
  it("binder til live-md5 lest 13.11.2026 og stopper ved avvik", () => {
    for (const m of ["2309db2c778a0db23c2f6bee2852cf86", "dc58b00ca0774c576f7fa8c8c044df4d", "e2d12782ccbe9b5cd7a3211fa4e9724c"]) expect(credit).toContain(m);
    expect(release).toContain("cb553c3def46e26a75e50ddd7d7758eb");
    expect(credit.match(/forventet (ett kall|én forekomst)/g)?.length).toBe(4);
  });
  it("vanlig faktura går fortsatt gjennom den uendrede 4-argumentsversjonen", () => {
    expect(credit).toContain("return public.rm_lines_sum_check(p_sum, p_count, p_total, p_vat);");
  });
  it("requeue krever skriverett, maks 200 og respekterer linjesperren", () => {
    expect(release).toContain("has_ravarer_invoice_access(p_legal_entity_id, 'write')");
    expect(release).toContain("_rm_invoice_extraction_blocker(v_id)");
    expect(release).toContain("cardinality(p_invoice_ids) > 200");
  });
});

describe("I – les på nytt i bolk (bare klargjort)", async () => {
  const { estimateCost, classifyStep, runSequential, parseRequeueResult } = await import("@/fakturaer/lib/bulkReread");
  it("kostnad er snitt per faktura fra loggen, ukjent uten nok grunnlag", () => {
    const rows = [
      { invoice_id: "a", estimated_cost_usd: 0.02, success: true }, { invoice_id: "a", estimated_cost_usd: 0.02, success: true },
      { invoice_id: "b", estimated_cost_usd: "0.04", success: true }, { invoice_id: "c", estimated_cost_usd: 0.04, success: true },
      { invoice_id: "d", estimated_cost_usd: 9, success: false },
    ];
    const e = estimateCost(rows, 45);
    expect(e.perInvoiceUsd).toBeCloseTo(0.04);
    expect(e.totalUsd).toBeCloseTo(1.8);
    expect(estimateCost(rows.slice(0, 3), 45).totalUsd).toBeNull();
    expect(estimateCost(null, 45).totalUsd).toBeNull();
  });
  it("utfall: sperret faktura hoppes over, AI-feil stopper resten", async () => {
    expect(classifyStep({ ok: false, code: "kostpris_fort" }, null)).toBe("hoppet_over");
    expect(classifyStep({ ok: true }, { code: null })).toBe("forslag");
    expect(classifyStep({ ok: true }, { code: "ai_feil_nokkel" })).toBe("ai_feil");
    expect(classifyStep({ ok: true }, { code: "ukjent_utfall" })).toBe("ukjent");
    const seen: number[] = [];
    const p = await runSequential([1, 2, 3, 4], async (n) => { seen.push(n); return n === 2 ? "ai_feil" : "forslag"; });
    expect(seen).toEqual([1, 2]);
    expect(p.stopped).toBe("ai_feil");
    const ac = new AbortController(); ac.abort();
    expect((await runSequential([1], async () => "forslag", { signal: ac.signal })).stopped).toBe("avbrutt");
  });
  it("svar fra requeue leses strengt", () => {
    expect(parseRequeueResult({ ok: true, requeued: 44, skipped: [{ invoice_id: "x", reason: "har_linjer" }] })?.requeued).toBe(44);
    expect(parseRequeueResult({ ok: true, requeued: 1 })).toBeNull();
    expect(parseRequeueResult(null)).toBeNull();
  });
});
