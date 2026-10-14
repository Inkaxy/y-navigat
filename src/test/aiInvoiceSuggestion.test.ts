import { describe, it, expect } from "vitest";
import { buildResponsesBody, parseResponsesOutput, classifyHttpError, AiCallError, effectiveReasoning } from "../../supabase/functions/_shared/ai-providers";
import { validateLineSuggestion, finiteOrNull, LINE_SUGGESTION_SCHEMA, type SuggestContext } from "../../supabase/functions/_shared/lineSuggestion";
import { deterministicChecks, isEvalModel, INVOICE_EXTRACTION_SCHEMA } from "../../supabase/functions/_shared/modelEval";
import { sanitizeLines } from "../../supabase/functions/_shared/invoiceExtraction";
import { INVOICE_EXTRACTION_SYSTEM_PROMPT } from "../../supabase/functions/_shared/invoiceExtractionPrompt";
import { parseAiSuggestion, parseAiSuggestionResponse, planAiApply, num } from "@/fakturaer/lib/aiLineSuggestion";
import { parseEvalOutcome } from "@/ravarer/lib/modelEval";
import { createHash } from "node:crypto";

const base = { provider: "openai" as const, apiKey: "k", maxTokens: 100, systemPrompt: "s", userText: "u" };

describe("Responses-kropp", () => {
  it("gpt-4o uendret: temperature, ingen reasoning/schema", () => {
    const b = buildResponsesBody({ ...base, model: "gpt-4o", temperature: 0.1 }, true);
    expect(b.temperature).toBe(0.1); expect(b.reasoning).toBeUndefined(); expect(b.text).toBeUndefined(); expect(b.max_output_tokens).toBe(100);
  });
  it("gpt-6: reasoning low, aldri temperature/top_p", () => {
    const b = buildResponsesBody({ ...base, model: "gpt-6.1-sol", temperature: 0.1 }, true);
    expect(b.reasoning).toEqual({ effort: "low" }); expect(b.temperature).toBeUndefined(); expect(b.top_p).toBeUndefined();
    expect(effectiveReasoning("gpt-4o", undefined)).toBeNull();
  });
  it("strict schema", () => {
    const b = buildResponsesBody({ ...base, model: "gpt-4o", jsonSchema: { name: "x", schema: { type: "object" } } }, false) as { text: { format: { strict: boolean; type: string } }; model?: string };
    expect(b.text.format).toMatchObject({ type: "json_schema", strict: true }); expect(b.model).toBeUndefined();
  });
  it("refusal, incomplete, tomt og 404 gir tydelige feil", () => {
    expect(() => parseResponsesOutput({ output: [{ content: [{ type: "refusal", refusal: "nei" }] }] })).toThrow(/avslo/);
    try { parseResponsesOutput({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "{\"a\":" }); } catch (e) { expect((e as AiCallError).kind).toBe("incomplete"); }
    expect(() => parseResponsesOutput({ output: [] })).toThrow(AiCallError);
    expect(classifyHttpError("OpenAI", 404, "{}").kind).toBe("model_unavailable");
    expect(classifyHttpError("OpenAI", 400, '{"error":{"code":"model_not_found"}}').kind).toBe("model_unavailable");
    expect(classifyHttpError("OpenAI", 500, "x").kind).toBe("http");
  });
  it("usage med bufret/resonnering", () => {
    const r = parseResponsesOutput({ status: "completed", output_text: "{}", usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 3 } } });
    expect(r).toMatchObject({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 4, reasoningTokens: 3 });
  });
});

const ctx = (over: Partial<SuggestContext> = {}): SuggestContext => ({
  line: { description: "Combisur Soft sekk 20kg", supplier_sku: "12113", quantity: 24, unit: "sekk", unit_price: 57.22, total_amount: 1373.28, package_size: null, package_unit: null, count_per_package: null, unit_price_basis: null, line_kind: "vare" },
  isCreditNote: false, currency: "NOK", candidates: [{ id: "rm-1", name: "Combisur", sku: null, base_unit: "kg", category: "Mel", item_type: "ravare" }],
  known: [], categories: ["Mel"], corrections: [], ...over,
});

describe("Validering av linjeforslag", () => {
  it("null er null, aldri 0", () => { expect(finiteOrNull(null)).toBeNull(); expect(num(null)).toBeNull(); expect(parseAiSuggestion({ decision: "unclear", confidence: null, package_size: null })!.confidence).toBeNull(); });
  it("forkaster oppdiktet id", () => {
    const v = validateLineSuggestion({ decision: "existing", raw_material_id: "fake", line_class: "vare" }, ctx());
    expect(v.raw_material_id).toBeNull(); expect(v.decision).toBe("unclear"); expect(v.rejected.join()).toMatch(/kandidat/);
  });
  it("pakning bare fra dokumentet; 1 som ikke står er forkastet", () => {
    expect(validateLineSuggestion({ decision: "existing", raw_material_id: "rm-1", line_class: "vare", package_size: 20, package_unit: "kg" }, ctx()).package_size).toBe(20);
    const v = validateLineSuggestion({ decision: "existing", raw_material_id: "rm-1", line_class: "vare", package_size: 1, package_unit: "stk" }, ctx());
    expect(v.package_size).toBeNull(); expect(v.package_unit).toBeNull(); expect(v.missing).toContain("pakningsstørrelse");
  });
  it("utkast uten kandidater: varenr fra fakturaen, ukjent kategori forkastes", () => {
    const v = validateLineSuggestion({ decision: "new_draft", line_class: "vare", draft: { name: "Combisur Soft", item_type: "ravare", category: "Oppdiktet", base_unit: "kg", supplier_sku: "999" } }, ctx({ candidates: [] }));
    expect(v.decision).toBe("new_draft"); expect(v.draft).toMatchObject({ supplier_sku: "12113", category: null, base_unit: "kg" }); expect(v.missing).toContain("kategori");
  });
  it("frakt/erstatning er aldri vare; kreditnota gir aldri ny vare", () => {
    expect(validateLineSuggestion({ decision: "existing", raw_material_id: "rm-1", line_class: "frakt" }, ctx())).toMatchObject({ decision: "not_raw_material", raw_material_id: null });
    expect(validateLineSuggestion({ decision: "new_draft", line_class: "erstatning", draft: { name: "x", item_type: "ravare", category: null, base_unit: null, supplier_sku: null } }, ctx()).draft).toBeNull();
    expect(validateLineSuggestion({ decision: "new_draft", line_class: "kreditnota", draft: { name: "x", item_type: "ravare", category: null, base_unit: null, supplier_sku: null } }, ctx()).decision).toBe("unclear");
  });
  it("schema er strict-kompatibelt (alle felt påkrevd)", () => {
    for (const s of [LINE_SUGGESTION_SCHEMA, INVOICE_EXTRACTION_SCHEMA]) {
      const props = Object.keys(s.properties as object); expect((s.required as string[]).sort()).toEqual(props.sort()); expect(s.additionalProperties).toBe(false);
    }
  });
});

describe("Bruk forslag bevarer brukerens endringer", () => {
  const s = parseAiSuggestion({ decision: "existing", raw_material_id: "rm-1", line_class: "vare", package_size: 20, package_unit: "kg" })!;
  it("tomt skjema fylles", () => expect(planAiApply(s, { selectedRmId: null, packageSize: "", packageUnit: "", packageTouched: false })).toMatchObject({ rawMaterialId: "rm-1", packageSize: "20", packageUnit: "kg", kept: [] }));
  it("annen valgt vare og endret pakning beholdes", () => {
    const p = planAiApply(s, { selectedRmId: "rm-2", packageSize: "25", packageUnit: "kg", packageTouched: true });
    expect(p.rawMaterialId).toBeNull(); expect(p.packageSize).toBeNull(); expect(p.kept).toContain("valgt vare");
  });
  it("ukjent svar er feil, ikke tomt forslag", () => {
    expect(parseAiSuggestionResponse({ suggestion: "x" }).reason).toBe("ai_feilet");
    expect(parseAiSuggestionResponse({ suggestion: null, reason: "modell_utilgjengelig" }).reason).toBe("modell_utilgjengelig");
  });
});

describe("Modellsammenligning", () => {
  it("allowlist", () => { expect(isEvalModel("gpt-4o")).toBe(true); expect(isEvalModel("gpt-6.1-sol")).toBe(true); expect(isEvalModel("gpt-5")).toBe(false); expect(isEvalModel(null)).toBe(false); });
  it("deterministiske kontroller: sumavvik og manglende pakning", () => {
    const lines = sanitizeLines([{ line_kind: "vare", description: "Combisur", quantity: 24, unit: "sekk", unit_price: 57.22, total_amount: 1373.28, unit_price_basis: "per_unit" }]);
    const r = deterministicChecks(lines, { excl: 27463.44, incl: null, vat: null });
    expect(r.counts.pakning_mangler).toBe(1); expect(r.counts.sumavvik).toBe(1);
  });
  it("utilgjengelig modell vises som sådan; ukjent kostnad er ukjent", () => {
    const o = parseEvalOutcome({ error: { code: "model_unavailable", message: "x" } }, "i", "gpt-6-luna");
    expect(o.statusLabel).toMatch(/ikke tilgjengelig/); expect(o.costUsd).toBeNull(); expect(o.checkCount).toBeNull();
    expect(parseEvalOutcome(null, "i", "gpt-4o").status).toBe("invalid_json");
  });
  it("prompten er byte-identisk med produksjonens", () => {
    expect(createHash("sha256").update(INVOICE_EXTRACTION_SYSTEM_PROMPT).digest("hex")).toBe("c915ec4f62e5fbdea77382cdfbc2cfc317d190a1cf608af8bc406047cd5d43c5");
  });
});

import { scoreAgainstFasit, EVAL_FASIT } from "../../supabase/functions/_shared/evalFasit";
import { buildExtractorRequest } from "../../supabase/functions/reread-invoice-preview/proposal";
import { readFileSync } from "node:fs";

describe("Fasit og bruksloggkobling", () => {
  const PALS = "dffd27f6-7f1b-4a3b-8c11-8f9cfa0ab95d";
  it("PALS 526301: riktig lesing gir 18/18, punktum-tusenfeil fanges", () => {
    const f = EVAL_FASIT[PALS];
    const ok = scoreAgainstFasit(PALS, { lines: f.lines, header: { total_excl_vat: 25784.74, total_vat: 3867.71, total_amount: 29652.45 } })!;
    expect(ok.fields_correct).toBe(18); expect(ok.errors).toEqual([]);
    const bad = scoreAgainstFasit(PALS, { lines: f.lines.map((l, i) => (i === 3 ? { ...l, quantity: 396000 } : l)), header: null })!;
    expect(bad.errors.join()).toMatch(/Linje 4 quantity: lest 396000/);
    expect(scoreAgainstFasit("annen", { lines: [], header: null })).toBeNull();
  });
  it("fasit sendes aldri som hint til modellen", () => {
    const ev = readFileSync("supabase/functions/invoice-model-eval/index.ts", "utf8");
    const hintsBlock = ev.slice(ev.indexOf("const hints: Hints"), ev.indexOf("const started"));
    expect(hintsBlock).not.toMatch(/fasit|EVAL_FASIT/i);
  });
  it("leser, ny lesing og Tripletex sender faktura-id til bruksloggen", () => {
    expect(buildExtractorRequest({ legalEntityId: "le", invoice: { supplier_id: null, invoice_number: null, is_credit_note: false, total_amount: 1, total_vat: 0 }, lines: [], supplierName: null, pdfBase64: "x", invoiceId: "inv-1" }).invoice_id).toBe("inv-1");
    expect(readFileSync("supabase/functions/tripletex-import-invoice-lines/index.ts", "utf8")).toContain("invoice_id: inv.id,");
    const ex = readFileSync("supabase/functions/extract-invoice-from-pdf/index.ts", "utf8");
    expect(ex.match(/invoice_id: usageInvoiceId/g)?.length).toBe(2);
    expect(ex).toContain('.eq("legal_entity_id", legal_entity_id)');
  });
});
