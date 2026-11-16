// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { clearLastAnswer, loadLastAnswer, packagePreview, parseUndoAnswer, parseUndoResult, quickAnswersFor, quickLabel, saveLastAnswer, suggestSkipReason, undoNeedsSql, undoSummary } from "@/ravarer/lib/quickAnswers";
import { classifyPending } from "@/lib/pendingRpc";

describe("svarknapper per spørsmålstype (B1)", () => {
  it("pris gir godta, spør leverandøren og pakningen er feil – i den rekkefølgen", () => {
    expect(quickAnswersFor("pris", { linked: true, locked: false })).toEqual(["godta", "spor", "pakning"]);
  });
  it("over avtalen foreslår kreditnota først", () => {
    expect(quickAnswersFor("over_avtale", { linked: true, locked: false })[0]).toBe("kreditnota");
  });
  it("sjekk pakning starter med pakningsretting", () => {
    expect(quickAnswersFor("sjekk_pakning", { linked: true, locked: false })[0]).toBe("pakning");
  });
  it("pant kan aldri hoppes over", () => {
    const k = quickAnswersFor("pant", { linked: false, locked: false });
    expect(k).not.toContain("hopp_alltid");
    expect(k).not.toContain("hopp_en_gang");
    expect(k[0]).toBe("folgevare");
  });
  it("paller/frakt kan hoppes over én gang eller alltid", () => {
    expect(quickAnswersFor("hopp_over", { linked: false, locked: false })).toEqual(["hopp_alltid", "hopp_en_gang", "velg_ravare"]);
  });
  it("låst varekort (godkjent/ført) gir ingen knapper", () => {
    expect(quickAnswersFor("pris", { linked: true, locked: true })).toEqual([]);
  });
  it("høyst tre knapper", () => {
    for (const t of ["pris", "over_avtale", "ukjent_vare", "pakning", "sjekk_pakning", "pant", "hopp_over"] as const) {
      expect(quickAnswersFor(t, { linked: true, locked: false }).length).toBeLessThanOrEqual(3);
    }
  });
});

describe("knappetekst", () => {
  it("godta viser pris med norsk komma og dato", () => {
    expect(quickLabel("godta", { price: 103, unit: "kg", date: "2026-11-03" })).toBe("Ja, godta 103,00 kr/kg fra 03.11");
  });
  it("spør nevner leverandøren", () => {
    expect(quickLabel("spor", { supplier: "TINE" })).toBe("Spør TINE først");
  });
  it("hopp over-årsak gjettes fra teksten", () => {
    expect(suggestSkipReason("EUR-PALL RETUR")).toBe("Pall");
    expect(suggestSkipReason("Miljøvederlag plast")).toBe("Miljøvederlag");
    expect(suggestSkipReason("Fraktgebyr")).toBe("Frakt");
  });
});

describe("forhåndsvisning av pakningsretting", () => {
  const line = { id: "a", invoice_number: "1", invoice_date: "2026-11-03", quantity: 4, unit: "kartong", total_amount: 4120, price_per_base_unit: 412, expected_price_per_base_unit: 98 };
  it("4 kartonger à 10 kg til 4 120 kr gir 103 kr/kg", () => {
    const [r] = packagePreview([line], 10, "kg");
    expect(r.after).toBeCloseTo(103, 6);
    expect(r.vsExpectedPct).toBeCloseTo(5.102, 2);
  });
  it("linje fakturert i grunnenheten påvirkes ikke", () => {
    const [r] = packagePreview([{ ...line, unit: "kg", price_per_base_unit: 25.75 }], 10, "kg");
    expect(r.unaffected).toBe(true);
    expect(r.after).toBe(25.75);
  });
  it("ukjent pakning gir ukjent pris, aldri 0", () => {
    const [r] = packagePreview([line], null, "kg");
    expect(r.after).toBeNull();
  });
});

describe("angre", () => {
  beforeEach(() => sessionStorage.clear());
  it("én gang angres uten databaseendring, pris og ikke vare krever den", () => {
    expect(undoNeedsSql({ kind: "en_gang", lines: [{ invoiceId: "i", lineId: "l", updatedAt: null }], label: "x", at: "t" })).toBe(false);
    expect(undoNeedsSql({ kind: "pris", lineIds: ["l"], label: "x", at: "t" })).toBe(true);
  });
  it("siste svar lagres per selskap og leses strengt", () => {
    saveLastAnswer("A", { kind: "pris", lineIds: ["l1"], label: "Smør", at: "2026-11-17" });
    expect(loadLastAnswer("A")?.kind).toBe("pris");
    expect(loadLastAnswer("B")).toBeNull();
    clearLastAnswer("A");
    expect(loadLastAnswer("A")).toBeNull();
  });
  it("ugyldig lagret svar gir ingen «Angre siste»", () => {
    expect(parseUndoAnswer({ kind: "pris", lineIds: [], label: "x", at: "t" })).toBeNull();
    expect(parseUndoAnswer({ kind: "ikke_vare", supplierId: "s", itemKey: "feil", lineIds: ["l"], label: "x", at: "t" })).toBeNull();
  });
  it("ukjent svar fra serveren er aldri «angret»", () => {
    expect(parseUndoResult({})).toBeNull();
    expect(parseUndoResult({ ok: true, undone: [], skipped: [{ id: 1 }] })).toBeNull();
    const o = parseUndoResult({ ok: true, undone: [{ id: "a" }], skipped: [{ id: "b", reason: "faktura_last" }], removed_rules: [{ id: "r" }] });
    expect(o).toEqual({ undone: 1, skipped: [{ id: "b", reason: "faktura_last" }], removedRules: 1 });
    expect(undoSummary(o!)).toContain("1 kunne ikke angres: fakturaen er avstemt");
  });
});

describe("ventende databaseobjekter", () => {
  it("404 og manglende kolonne betyr «ikke kjørt ennå»", () => {
    expect(classifyPending(404, { code: "PGRST202" }).kind).toBe("missing");
    expect(classifyPending(400, { code: "42703" }).kind).toBe("missing");
  });
  it("manglende tilgang er avvisning, 5xx er ukjent", () => {
    expect(classifyPending(403, null).kind).toBe("denied");
    expect(classifyPending(500, null).kind).toBe("error");
    expect(classifyPending(200, true)).toEqual({ kind: "ok", data: true });
  });
});
