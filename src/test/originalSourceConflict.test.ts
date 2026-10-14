import { describe, expect, it } from "vitest";
import { skuInRow, validateLineSuggestion, type SuggestContext } from "../../supabase/functions/_shared/lineSuggestion";
import { applyOriginalGate } from "../../supabase/functions/_shared/lineSuggestionSource";
import { guardStoredKeyTest } from "../../supabase/functions/_shared/aiConfigTestGuard";
import { aiTimeoutFor, SUGGEST_AI_MAX_MS, SUGGEST_CLIENT_TIMEOUT_MS, SUGGEST_SERVER_BUDGET_MS } from "../../supabase/functions/_shared/suggestTimeouts";
import { SUGGEST_CLIENT_TIMEOUT_MS as APP_TIMEOUT } from "@/fakturaer/lib/aiLineSuggestion";

const ctx = (desc: string, sku: string | null, original?: SuggestContext["original"]): SuggestContext => ({
  line: { description: desc, supplier_sku: sku, quantity: 2, unit: "sekk", unit_price: 100, total_amount: 200, package_size: null, package_unit: null, count_per_package: null, unit_price_basis: null, line_kind: null },
  isCreditNote: false, currency: "NOK", candidates: [{ id: "rm1", name: "Mel", sku: null, base_unit: "kg", category: "Mel", item_type: "ravare" }],
  known: [], packages: [], categories: ["Mel"], corrections: [], original,
});
const newDraft = { decision: "new_draft", line_class: "ravare", draft: { name: "Hvetemel", item_type: "ravare", category: "Mel", base_unit: "kg", supplier_sku: "5301 0" } };

describe("originalgrunnlag mot registrert linje", () => {
  it("lagret «10kg» vs original «2x5kg» i tekstlaget: pakning valideres mot originalraden", () => {
    const v = validateLineSuggestion({ decision: "existing", raw_material_id: "rm1", line_class: "ravare", package_size: 5, package_unit: "kg", count_per_package: 2 },
      ctx("Hvetemel 10kg", "5301 0", { mode: "tekst", row: "5301 0 Hvetemel 2x5kg 2 sekk 100,00", by: "sku" }));
    expect([v.package_size, v.count_per_package, v.package_unit]).toEqual([5, 2, "kg"]);
    expect(v.evidence.find((e) => e.field === "pakning")?.source).toBe("faktura");
    expect(v.uncertainties.join(" ")).toContain("Rett fakturalinje");
  });
  it("lagret 10 kg foreslått mot original 2x5kg avvises ikke som original 10 kg", () => {
    const v = validateLineSuggestion({ decision: "existing", raw_material_id: "rm1", line_class: "ravare", package_size: 10, package_unit: "kg", count_per_package: 2 },
      ctx("Hvetemel 10kg", "5301 0", { mode: "tekst", row: "5301 0 Hvetemel 2x5kg", by: "sku" }));
    expect(v.package_size).toBeNull();
  });
  it("PDF-modus med motstrid: ingen pakningsautofyll fra registrert linje", () => {
    const v = validateLineSuggestion({ decision: "existing", raw_material_id: "rm1", line_class: "ravare", package_size: 10, package_unit: "kg", original_row_text: "5301 0 Hvetemel 2x5kg", original_differences: ["Original: 2x5kg – registrert: 10kg"] },
      ctx("Hvetemel 10kg", "5301 0", { mode: "pdf", row: null, by: null }));
    expect(v.package_size).toBeNull();
    expect(v.raw_material_id).toBe("rm1"); // forklaring/vare kan stå
  });
  it("uten verifisert originalrad merkes pakning og «lest» bevis som registrert linje", () => {
    const v = validateLineSuggestion({ decision: "existing", raw_material_id: "rm1", line_class: "ravare", package_size: 10, package_unit: "kg", evidence: [{ field: "mengde", value: "2", source: "faktura" }] },
      ctx("Hvetemel 10kg", "5301 0", { mode: "pdf", row: null, by: null }));
    expect(v.package_size).toBe(10);
    expect(v.evidence.every((e) => e.source !== "faktura")).toBe(true);
    expect(v.evidence.find((e) => e.field === "pakning")?.source).toBe("registrert_linje");
  });
  it("feil SKU: registrert «5301» står ikke som eget nummer i originalraden «5301 0» → utkast uten varenummer", () => {
    expect(skuInRow("5301 0 Hvetemel", "5301")).toBe(false);
    expect(skuInRow("5301 0 Hvetemel", "53010")).toBe(true);
    expect(skuInRow("53012 Hvetemel", "5301")).toBe(false);
    const v = validateLineSuggestion({ ...newDraft, draft: { ...newDraft.draft, supplier_sku: "5301" } }, ctx("Hvetemel", "5301", { mode: "tekst", row: "5301 0 Hvetemel 25kg", by: "beskrivelse" }));
    expect(v.draft?.supplier_sku).toBeNull();
    expect(v.rejected.join(" ")).toContain("ikke bekreftet i originalraden");
    const ok = validateLineSuggestion(newDraft, ctx("Hvetemel", "5301 0", { mode: "tekst", row: "5301 0 Hvetemel 25kg", by: "sku" }));
    expect(ok.draft?.supplier_sku).toBe("5301 0");
  });
  it("original_row_found=false fjerner hallucinert bevis og prisgrunnlag", () => {
    const raw = { decision: "existing", raw_material_id: "rm1", line_class: "ravare", price_basis: "per_kg", original_row_found: false,
      evidence: [{ field: "mengde", value: "2", source: "faktura" }, { field: "enhetspris", value: "100", source: "faktura" }, { field: "vare", value: "x", source: "kjent_vare" }] };
    const v = validateLineSuggestion(raw, ctx("Hvetemel", "5301 0", { mode: "pdf", row: null, by: null }));
    const g = applyOriginalGate(v, raw, "pdf", null, "v1", null).suggestion;
    expect(g.price_basis).toBe("ukjent");
    expect(g.evidence.map((e) => e.source)).toEqual(["kjent_vare"]);
    expect(g.missing.join(" ")).not.toMatch(/prisgrunnlag/i);
    expect(g.decision).toBe("unclear");
  });
});

describe("tilkoblingstest med lagret nøkkel", () => {
  const cfg = { id: "c1", provider: "openai", model: "gpt-4o", updated_at: "2026-10-14T08:54:00.123456+00:00" };
  it("krever id og revisjon", () => {
    expect(guardStoredKeyTest({}, cfg)).toMatchObject({ ok: false, status: 400 });
    expect(guardStoredKeyTest({ config_id: "c1" }, cfg)).toMatchObject({ ok: false, status: 400 });
  });
  it("samme id med endret revisjon (også bare mikrosekund) og annen id avvises som stale", () => {
    expect(guardStoredKeyTest({ config_id: "c1", expected_updated_at: "2026-10-14T08:54:00.123457+00:00" }, cfg)).toMatchObject({ ok: false, status: 409 });
    expect(guardStoredKeyTest({ config_id: "c2", expected_updated_at: cfg.updated_at }, cfg)).toMatchObject({ ok: false, status: 409 });
  });
  it("eksakt match går videre; provider/endepunkt kan ikke overstyres", () => {
    expect(guardStoredKeyTest({ config_id: "c1", expected_updated_at: cfg.updated_at }, cfg)).toEqual({ ok: true, model: "gpt-4o" });
    expect(guardStoredKeyTest({ config_id: "c1", expected_updated_at: cfg.updated_at, provider: "anthropic" }, cfg)).toMatchObject({ ok: false });
    expect(guardStoredKeyTest({ config_id: "c1", expected_updated_at: cfg.updated_at, azure_endpoint: "https://x" }, cfg)).toMatchObject({ ok: false });
  });
});

describe("samordnede frister", () => {
  it("klienten venter lenger enn hele serverbudsjettet", () => {
    expect(APP_TIMEOUT).toBe(SUGGEST_CLIENT_TIMEOUT_MS);
    expect(SUGGEST_CLIENT_TIMEOUT_MS).toBeGreaterThan(SUGGEST_SERVER_BUDGET_MS);
    expect(SUGGEST_AI_MAX_MS.pdf).toBeLessThan(SUGGEST_SERVER_BUDGET_MS);
  });
  it("AI-fristen krymper med brukt tid og avstår når budsjettet er brukt", () => {
    expect(aiTimeoutFor(0, 0, true)).toBe(SUGGEST_AI_MAX_MS.pdf);
    expect(aiTimeoutFor(0, 60_000, true)).toBe(38_000);
    expect(aiTimeoutFor(0, 95_000, true)).toBeNull();
  });
});
