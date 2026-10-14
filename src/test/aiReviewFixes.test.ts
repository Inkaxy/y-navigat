import { describe, it, expect, vi, afterEach } from "vitest";
import { AiCallError, estimateCostUsd, hasCachedRate, parseResponsesOutput, timedFetch, usageOf, COST_RATE_VERSION } from "../../supabase/functions/_shared/ai-providers";
import { packExpressions, stripPrices, validateLineSuggestion, buildSuggestUserText, type SuggestContext } from "../../supabase/functions/_shared/lineSuggestion";
import { INVOICE_EXTRACTION_SCHEMA, INVOICE_EXTRACTION_SCHEMA_VERSION } from "../../supabase/functions/_shared/modelEval";
import { extractionSchemaEnabled } from "../../supabase/functions/_shared/extractionSchemaFlag";
import { INVOICE_EXTRACTION_SYSTEM_PROMPT } from "../../supabase/functions/_shared/invoiceExtractionPrompt";
import { planAiApply, type AiLineSuggestion } from "@/fakturaer/lib/aiLineSuggestion";

const ctx = (over: Partial<SuggestContext> = {}, line: Partial<SuggestContext["line"]> = {}): SuggestContext => ({
  line: { description: "Combisur Soft sekk 20kg", supplier_sku: "12113", quantity: 24, unit: "sekk", unit_price: 57.22, total_amount: 1373.28, package_size: null, package_unit: null, count_per_package: null, unit_price_basis: null, line_kind: "vare", ...line },
  isCreditNote: false, currency: "NOK", candidates: [{ id: "rm-1", name: "Combisur", sku: null, base_unit: "kg", category: "Mel", item_type: "ravare" }],
  known: [], packages: [], categories: ["Mel"], corrections: [], ...over,
});
const draft = { name: "Combisur", item_type: "ravare", category: "Mel", base_unit: "kg", supplier_sku: "12113" };

describe("1) kreditnota og autoritativ linjetype", () => {
  it("kreditnota-dokument gir aldri ny vare, selv når modellen kaller linjen vare", () => {
    const v = validateLineSuggestion({ decision: "new_draft", line_class: "vare", draft }, ctx({ isCreditNote: true }));
    expect(v.decision).toBe("unclear"); expect(v.draft).toBeNull(); expect(v.rejected.join()).toMatch(/Kreditnota/);
  });
  it("registrert frakt/pant vinner over modellens «vare»", () => {
    const v = validateLineSuggestion({ decision: "existing", raw_material_id: "rm-1", line_class: "vare" }, ctx({}, { line_kind: "frakt" }));
    expect(v.decision).toBe("not_raw_material"); expect(v.raw_material_id).toBeNull();
  });
});

describe("2) pakning bare fra konkret uttrykk eller entydig bekreftet variant", () => {
  it("1000 stk kan ikke bli 1000 kg", () => {
    const v = validateLineSuggestion({ decision: "existing", raw_material_id: "rm-1", line_class: "vare", package_size: 1000, package_unit: "kg" }, ctx({}, { description: "Muffinsform 1000stk" }));
    expect(v.package_size).toBeNull(); expect(v.package_unit).toBeNull();
  });
  it("tall i produktnavn uten enhet godtas ikke", () => {
    const v = validateLineSuggestion({ decision: "existing", raw_material_id: "rm-1", line_class: "vare", package_size: 75, package_unit: "kg" }, ctx({}, { description: "Sjokolade 75" }));
    expect(v.package_size).toBeNull();
  });
  it("25 kg på linjen godtas, men uten kontrollert original merket som registrert linje", () => {
    const v = validateLineSuggestion({ decision: "existing", raw_material_id: "rm-1", line_class: "vare", package_size: 20, package_unit: "kg" }, ctx());
    expect(v).toMatchObject({ package_size: 20, package_unit: "kg", count_per_package: null });
    expect(v.evidence[0]).toMatchObject({ field: "pakning", source: "registrert_linje" });
  });
  it("2x5kg: 2 indre pakninger à 5 kg; 10 kg uten antall normaliseres", () => {
    expect(packExpressions("Smør 2x5kg")).toEqual([{ count: 2, size: 5, unit: "kg", raw: "2x5kg" }]);
    const a = validateLineSuggestion({ decision: "existing", raw_material_id: "rm-1", line_class: "vare", package_size: 5, package_unit: "kg", count_per_package: 2 }, ctx({}, { description: "Smør 2x5kg" }));
    expect(a).toMatchObject({ package_size: 5, count_per_package: 2 });
    const b = validateLineSuggestion({ decision: "existing", raw_material_id: "rm-1", line_class: "vare", package_size: 10, package_unit: "kg", count_per_package: null }, ctx({}, { description: "Smør 2x5kg" }));
    expect(b).toMatchObject({ package_size: 5, package_unit: "kg", count_per_package: 2 });
  });
  it("motstridende uttrykk gir null med forklaring", () => {
    const v = validateLineSuggestion({ decision: "existing", raw_material_id: "rm-1", line_class: "vare", package_size: 5, package_unit: "kg" }, ctx({}, { description: "Mel 5kg / 25kg" }));
    expect(v.package_size).toBeNull(); expect(v.rejected.join()).toMatch(/flere pakningsuttrykk/);
  });
  it("entydig bekreftet variant godtas; base_units_per_package blir aldri antall", () => {
    const pk = [{ raw_material_id: "rm-1", supplier_sku_norm: "12113", package_size: 20, package_unit: "kg", confirmed: true }];
    const ok = validateLineSuggestion({ decision: "existing", raw_material_id: "rm-1", line_class: "vare", package_size: 20, package_unit: "kg" }, ctx({ packages: pk }, { description: "Combisur Soft sekk" }));
    expect(ok).toMatchObject({ package_size: 20, count_per_package: null }); expect(ok.evidence[0].source).toBe("kjent_vare");
    const known = [{ raw_material_id: "rm-1", name: "C", supplier_sku: "12113", supplier_product_name: null, package_size: 20, package_unit: "kg", base_units_per_package: 20, confirmed: true }];
    const cnt = validateLineSuggestion({ decision: "existing", raw_material_id: "rm-1", line_class: "vare", package_size: 20, package_unit: "kg", count_per_package: 20 }, ctx({ known }, { description: "Combisur Soft sekk" }));
    expect(cnt.count_per_package).toBeNull();
    const two = [...pk, { ...pk[0], package_size: 25 }];
    expect(validateLineSuggestion({ decision: "existing", raw_material_id: "rm-1", line_class: "vare", package_size: 20, package_unit: "kg" }, ctx({ packages: two }, { description: "Combisur" })).package_size).toBeNull();
  });
  it("forkastet pakningsbevis vises ikke som lest", () => {
    const v = validateLineSuggestion({ decision: "existing", raw_material_id: "rm-1", line_class: "vare", package_size: 75, package_unit: "kg", evidence: [{ field: "package_size", value: "75 kg", source: "faktura" }] }, ctx({}, { description: "Sjokolade 75" }));
    expect(v.evidence.some((e) => /75/.test(e.value))).toBe(false);
  });
  it("rettelser sendes uten priser", () => {
    expect(stripPrices([{ original: { unit_price: 10, description: "a" }, corrected: { total_amount: 5, quantity: 2 } }])).toEqual([{ original: { description: "a" }, corrected: { quantity: 2 } }]);
    expect(buildSuggestUserText(ctx({ corrections: [{ original: { unit_price: 999 } }] }))).not.toContain("999");
  });
});

describe("4) «Bruk forslag» fyller ikke pakning på annen vare eller fra utkast", () => {
  const s = { decision: "existing", rawMaterialId: "rm-1", packageSize: 20, packageUnit: "kg" } as AiLineSuggestion;
  it("annen manuelt valgt vare får ikke pakningen", () => {
    const p = planAiApply(s, { selectedRmId: "rm-2", packageSize: "", packageUnit: "", packageTouched: false });
    expect(p.packageSize).toBeNull(); expect(p.rawMaterialId).toBeNull();
  });
  it("nytt utkast fyller ikke koblingsskjemaets pakning", () => {
    const d = { ...s, decision: "new_draft", rawMaterialId: null } as AiLineSuggestion;
    expect(planAiApply(d, { selectedRmId: "rm-2", packageSize: "", packageUnit: "", packageTouched: false }).packageSize).toBeNull();
    expect(planAiApply(d, { selectedRmId: null, packageSize: "", packageUnit: "", packageTouched: false }).packageSize).toBeNull();
  });
  it("samme foreslåtte vare får pakningen", () => {
    expect(planAiApply(s, { selectedRmId: "rm-1", packageSize: "", packageUnit: "", packageTouched: false })).toMatchObject({ packageSize: "20", packageUnit: "kg" });
  });
});

describe("5) kostnad, forbruk ved feil og tidsfrist på svarkroppen", () => {
  it("publiserte satser for gpt-6.1-sol og gpt-6-luna, bufret til egen sats", () => {
    expect(estimateCostUsd("gpt-6.1-sol", 1_000_000, 1_000_000)).toBeCloseTo(12);
    expect(estimateCostUsd("gpt-6.1-sol", 1_000_000, 0, 400_000)).toBeCloseTo(0.6 * 2 + 0.4 * 0.1);
    expect(estimateCostUsd("gpt-6-luna", 1_000_000, 1_000_000, 1_000_000)).toBeCloseTo(0.01 + 0.5);
    expect(estimateCostUsd("gpt-4o", 1_000_000, 0, 1_000_000)).toBeCloseTo(2.5); // ingen bufret sats → konservativt
    expect(hasCachedRate("gpt-4o")).toBe(false); expect(COST_RATE_VERSION).toBe("2026-10-14");
    expect(estimateCostUsd("ukjent", 1, 1)).toBeNull();
  });
  it("avslag og ufullstendig beholder rapportert forbruk", () => {
    const usage = { input_tokens: 900, output_tokens: 50 };
    try { parseResponsesOutput({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage }); } catch (e) {
      expect(e).toBeInstanceOf(AiCallError); expect(usageOf(e)).toMatchObject({ inputTokens: 900, outputTokens: 50 });
    }
    try { parseResponsesOutput({ output: [{ content: [{ type: "refusal", refusal: "nei" }] }], usage }); } catch (e) { expect(usageOf(e)?.inputTokens).toBe(900); }
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("tidsfristen gjelder også lesing av svarkroppen", async () => {
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => Promise.resolve({
      ok: true, status: 200,
      text: () => new Promise<string>((_r, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted")))),
    } as unknown as Response));
    await expect(timedFetch("https://x", {}, 30)).rejects.toMatchObject({ kind: "timeout" });
  });
});

describe("7) strict schema i fakturaleseren", () => {
  type S = { type?: string; required?: string[]; properties?: Record<string, S>; additionalProperties?: boolean; items?: S; anyOf?: S[] };
  const strictOk = (s: S): boolean => {
    if (s.anyOf) return s.anyOf.every(strictOk);
    if (s.type === "object") return s.additionalProperties === false && Object.keys(s.properties ?? {}).every((k) => s.required?.includes(k)) && Object.values(s.properties ?? {}).every(strictOk);
    if (s.type === "array") return strictOk(s.items ?? {});
    return true;
  };
  it("schemaet er gyldig strict og dekker alle felt prompten ber om", () => {
    const sch = INVOICE_EXTRACTION_SCHEMA as S;
    expect(strictOk(sch)).toBe(true);
    const top = Object.keys(sch.properties!);
    const line = Object.keys(sch.properties!.lines.items!.properties!);
    for (const f of ["supplier_org_number", "kid_number", "account_number", "lines_sum_self_check", "field_confidence"]) expect(top).toContain(f);
    for (const f of ["line_kind", "sku", "ean", "quantity_raw", "unit_price_raw", "total_amount_raw", "unit_price_basis", "discount_pct", "count_per_package", "confidence"]) {
      expect(line).toContain(f); expect(INVOICE_EXTRACTION_SYSTEM_PROMPT).toContain(f);
    }
    expect(INVOICE_EXTRACTION_SCHEMA_VERSION).toMatch(/^strict-v3/);
  });
  it("er av som standard og bare for OpenAI/Azure", () => {
    expect(extractionSchemaEnabled(undefined, "openai")).toBe(false);
    expect(extractionSchemaEnabled("on", "openai")).toBe(true);
    expect(extractionSchemaEnabled("on", "azure_openai")).toBe(true);
    expect(extractionSchemaEnabled("on", "anthropic")).toBe(false);
  });
});

describe("2x5kg: ingen dobbeltelling ende-til-ende", async () => {
  const { validatePackage } = await import("../../supabase/functions/_shared/lineSuggestion");
  const { planAiApply } = await import("@/fakturaer/lib/aiLineSuggestion");
  const text = "Idun Combisur 2x5kg";
  it("sub-enhet 5 × 2 godtas som faktura", () => {
    expect(validatePackage({ size: 5, unit: "kg", count: 2 }, text, [], [])).toMatchObject({ size: 5, unit: "kg", count: 2 });
  });
  it("totalt 10 uten antall normaliseres til 5 × 2", () => {
    expect(validatePackage({ size: 10, unit: "kg", count: null }, text, [], [])).toMatchObject({ size: 5, count: 2 });
  });
  it("10 × 2 (GPT-4o-feilen) avvises, aldri 20 kg", () => {
    const r: string[] = [];
    expect(validatePackage({ size: 10, unit: "kg", count: 2 }, text, [], r)).toMatchObject({ size: null, count: null });
    expect(r.length).toBe(1);
  });
  it("skjemaet fylles med hele pakningen 10 kg, ikke 5 eller 20", () => {
    const s = { decision: "existing", rawMaterialId: "rm1", packageSize: 5, packageUnit: "kg", countPerPackage: 2 } as never;
    expect(planAiApply(s, { selectedRmId: null, packageSize: "", packageUnit: "", packageTouched: false }).packageSize).toBe("10");
    const single = { decision: "existing", rawMaterialId: "rm1", packageSize: 12.5, packageUnit: "kg", countPerPackage: null } as never;
    expect(planAiApply(single, { selectedRmId: null, packageSize: "", packageUnit: "", packageTouched: false }).packageSize).toBe("12,5");
  });
});

describe("prisgrunnlag fra modellen er alltid forslag", async () => {
  const { validateLineSuggestion } = await import("../../supabase/functions/_shared/lineSuggestion");
  const ctx = { candidates: [], known: [], corrections: [], line: { description: "Smoothiebeger 358713", supplier_sku: "358713", quantity: 1, unit: "krt", unit_price: 1, total_amount: 1, package_size: null, package_unit: null, count_per_package: null, unit_price_basis: null, line_kind: "vare", line_class: null, isCreditNote: false, excluded: false }, variants: [] } as never;
  it("price_basis merket faktura vises som forslag, med «Prisgrunnlag må bekreftes»", () => {
    const r = validateLineSuggestion({ decision: "unclear", line_class: "emballasje", price_basis: "per_pakning", evidence: [{ field: "price_basis", value: "per_pakning", source: "faktura" }, { field: "prisgrunnlag", value: "per_pakning", source: "faktura" }] }, ctx);
    expect(r.evidence.filter((e) => /basis|prisgrunnlag/i.test(e.field))).toEqual([{ field: "prisgrunnlag", value: "per_pakning", source: "forslag" }]);
    expect(r.missing).toContain("Prisgrunnlag må bekreftes");
    expect(r.price_basis).toBe("per_pakning");
  });
  it("ukjent prisgrunnlag gir ingen bevisrad", () => {
    const r = validateLineSuggestion({ decision: "unclear", price_basis: "ukjent", evidence: [] }, ctx);
    expect(r.evidence.some((e) => e.field === "prisgrunnlag")).toBe(false);
  });
});
