import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * AI-forslag for fakturalinjer. Alle svar er mocket — testene gjør ALDRI
 * ekte kall til en AI-leverandør, og bruker ingen kundedata.
 */
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

const { fetchAiLineSuggestion } = await import("@/fakturaer/lib/aiLineSuggestion");

beforeEach(() => invoke.mockReset());

describe("fetchAiLineSuggestion", () => {
  it("leser modellsvaret som et forslag, ikke som en bekreftelse", async () => {
    invoke.mockResolvedValue({
      data: {
        suggestion: {
          raw_material_id: "rm1",
          confidence: 0.82,
          package_size: 25,
          package_unit: "kg",
          explanation: "Navnet og pakningen stemmer med Hvetemel 25 kg.",
          uncertainties: ["Leverandørens varenummer er ukjent"],
          model: "test-model",
        },
        reason: null,
      },
      error: null,
    });
    const res = await fetchAiLineSuggestion({ invoiceLineId: "l1" });
    expect(res.suggestion?.rawMaterialId).toBe("rm1");
    expect(res.suggestion?.confidence).toBe(0.82);
    expect(res.suggestion?.uncertainties).toHaveLength(1);
    expect(res.reason).toBeNull();
  });

  it("faller tilbake til manuell arbeidsflyt når AI ikke er satt opp", async () => {
    invoke.mockResolvedValue({ data: { suggestion: null, reason: "ingen_ai_konfigurasjon" }, error: null });
    const res = await fetchAiLineSuggestion({ invoiceLineId: "l1" });
    expect(res.suggestion).toBeNull();
    expect(res.reason).toBe("ingen_ai_konfigurasjon");
  });

  it("gir manuell fallback ved feil fra funksjonen", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("boom") });
    const res = await fetchAiLineSuggestion({ invoiceLineId: "l1" });
    expect(res).toEqual({ suggestion: null, reason: "ai_feilet" });
  });

  it("gir tidsavbrudd i stedet for å henge når modellen bruker for lang tid", async () => {
    invoke.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ data: null, error: null }), 200)),
    );
    const res = await fetchAiLineSuggestion({ invoiceLineId: "l1", timeoutMs: 10 });
    expect(res.reason).toBe("tidsavbrudd");
  });

  it("forkaster ukjente feltverdier fra modellen", async () => {
    invoke.mockResolvedValue({
      data: {
        suggestion: {
          raw_material_id: null,
          confidence: "svært sikker",
          package_size: "mye",
          package_unit: "",
          explanation: null,
          uncertainties: null,
          model: "test-model",
        },
        reason: null,
      },
      error: null,
    });
    const res = await fetchAiLineSuggestion({ invoiceLineId: "l1" });
    expect(res.suggestion).toEqual({
      rawMaterialId: null,
      confidence: null,
      packageSize: null,
      packageUnit: null,
      explanation: null,
      uncertainties: [],
      model: "test-model",
    });
  });
});
