import { describe, expect, it } from "vitest";
import { applyOriginalGate } from "../../supabase/functions/_shared/lineSuggestionSource";
import { alignLineRow, type PdfTextResult } from "../../supabase/functions/_shared/pdfText";
import { annotateSkuTextCheck, sanitizeLines } from "../../supabase/functions/_shared/invoiceExtraction";
import { isCatalogModel, validateModelSettings } from "../../supabase/functions/_shared/aiModelCatalog";
import type { ValidatedSuggestion } from "../../supabase/functions/_shared/lineSuggestion";
import { parseAiSuggestion } from "@/fakturaer/lib/aiLineSuggestion";

const base: ValidatedSuggestion = {
  decision: "existing", raw_material_id: "rm1", line_class: "emballasje", confidence: 0.9, package_size: 1000, package_unit: "stk",
  count_per_package: null, price_basis: "per_stk", draft: null, evidence: [], explanation: null, uncertainties: [], missing: [], rejected: [],
};
const text = (pages: string[]): PdfTextResult => ({ status: "ok", pages, totalPages: pages.length, pagesRead: pages.length, chars: pages.join("").length, truncated: false });

describe("linjeforslag: originalgrunnlag", () => {
  it("manglende original = registrert linje, forslag uendret", () => {
    const r = applyOriginalGate(base, {}, "ingen", null, null, "mangler");
    expect(r.source.status).toBe("registrert_linje");
    expect(r.source.originalReason).toBe("mangler");
    expect(r.source.documentVersion).toBeNull();
    expect(r.suggestion.raw_material_id).toBe("rm1");
  });
  it("original sendt men raden ikke entydig → unclear uten vare/pakning", () => {
    const r = applyOriginalGate(base, { original_row_found: false }, "pdf", null, "v1", null);
    expect(r.suggestion.decision).toBe("unclear");
    expect(r.suggestion.raw_material_id).toBeNull();
    expect(r.suggestion.package_size).toBeNull();
    expect(r.source.status).toBe("original_pdf");
  });
  it("entydig tekstrad + avvik (Smoothiebeger 0,90 per stk vs registrert 0,72 per eske) rapporteres, endrer ingenting", () => {
    const r = applyOriginalGate(base, { original_row_found: true, original_differences: ["Original: 0,90 per stk – registrert: 0,72 per eske"] }, "tekst", { page: 2, row: "358713 Smoothiebeger 1000 stk 0,90" }, "v1", null);
    expect(r.source).toMatchObject({ status: "original_tekst", documentVersion: "v1", page: 2 });
    expect(r.source.differences).toHaveLength(1);
    expect(r.suggestion.raw_material_id).toBe("rm1");
    expect(r.suggestion.uncertainties.join(" ")).toContain("Rett fakturalinje");
  });
  it("klienten: uten dokumentversjon regnes forslaget aldri som lest fra originalen", () => {
    const s = parseAiSuggestion({ decision: "unclear", source_status: "original_tekst", document_version: null });
    expect(s?.sourceStatus).toBe("original_tekst");
    expect(s?.documentVersion).toBeNull();
  });
});

describe("radjustering i tekstlaget", () => {
  const t = text(["5011 0 HASSEL 10 kg\n5301 0 HASSELNØTTER 10 kg 113,00\n6541 1 TRANEBÆR 11,34 kg\n53010 ANNEN VARE 1 kg"]);
  it("fullt varenummer med mellomrom treffer riktig rad; kort nummer gir ingen", () => {
    expect(alignLineRow(t, "5301 0", null)).toMatchObject({ by: "sku", row: expect.stringContaining("HASSELNØTTER") });
    expect(alignLineRow(t, "5301", null).by).toBe("ingen");
  });
  it("tvetydig beskrivelse → flere, aldri valgt rad", () => {
    expect(alignLineRow(text(["Smoothiebeger 400 ml\nSmoothiebeger 400 ml lokk"]), null, "Smoothiebeger 400").by).toBe("flere");
  });
  it("ikke brukbart tekstlag → ingen", () => {
    expect(alignLineRow({ ...t, status: "ingen_tekst" }, "5301 0", null).by).toBe("ingen");
  });
});

describe("leseren bevarer trykt varenummer og råfelt", () => {
  it("sku_raw vinner over modellens forkortede sku; avviket bevares", () => {
    const [l] = sanitizeLines([{ sku: "5301", sku_raw: "5301 0", description: "Hassel", quantity: 10, unit: "kg", unit_price: 113, total_amount: 1130, package_raw: "SEKK 10KG", unit_price_unit_raw: "KG", page_number: 1 }]);
    expect(l.sku).toBe("5301 0");
    expect(l.sku_model).toBe("5301");
    expect(l.package_raw).toBe("SEKK 10KG");
    expect(l.unit_price_unit_raw).toBe("KG");
    expect(l.page_number).toBe(1);
  });
  it("ukjent side er null, aldri 0", () => {
    const [l] = sanitizeLines([{ sku: "1", description: "x", page_number: 0 }]);
    expect(l.page_number).toBeNull();
  });
  it("tekstkontroll merker bare, endrer aldri sku", () => {
    const lines = sanitizeLines([{ sku_raw: "5301 0", description: "a" }, { sku_raw: "9999 9", description: "b" }]);
    const out = annotateSkuTextCheck(lines, ["5301 0 HASSEL 10 kg"]);
    expect(out.map((l) => l.sku_text_check)).toEqual(["funnet", "ikke_funnet"]);
    expect(out[1].sku).toBe("9999 9");
  });
});

describe("modellkatalog og innstillinger", () => {
  it("allowlist er per provider", () => {
    expect(isCatalogModel("openai", "gpt-6.1-sol")).toBe(true);
    expect(isCatalogModel("azure_openai", "gpt-6.1-sol")).toBe(false);
    expect(isCatalogModel("openai", "gpt-9")).toBe(false);
  });
  it("validerer grenser", () => {
    expect(validateModelSettings("openai", "gpt-4o", 4000, 0.1)).toBeNull();
    expect(validateModelSettings("openai", "gpt-4o", 10, 0.1)).not.toBeNull();
    expect(validateModelSettings("openai", "gpt-4o", 4000, 3)).not.toBeNull();
    expect(validateModelSettings("openai", "gpt-4o", 4000.5, 0.1)).not.toBeNull();
  });
});
