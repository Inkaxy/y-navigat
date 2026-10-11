import { describe, expect, it } from "vitest";
import { parseWorkItems } from "@/ravarer/lib/workRpc";
import { workEffect } from "@/ravarer/lib/workEffect";
import { canFetchLines, deliverySteps, sumOk, sumStatusLabel } from "@/ravarer/pages/priskontroll/faktura/invoiceSteps";
import { factsSummary } from "@/ravarer/pages/priskontroll/faktura/InvoiceFactsSection";
import { controlFigures } from "@/ravarer/pages/priskontroll/faktura/ControlSummary";
import { groupCountText } from "@/ravarer/pages/priskontroll/gjore/groupCopy";
import { readingReliability } from "@/fakturaer/lib/invoiceFacts";

const base = { key: "faktura:1", grp: "fakturaer", kind: "faktura_sumavvik", title: "PALS 526301", amount: 29652.45 };

describe("kronevirkning i Å gjøre", () => {
  it("gammel server uten effektfelt: aldri bruttobeløp som virkning", () => {
    const [it0] = parseWorkItems({ items: [{ ...base, impact_nok: 317318.76 }] }).items;
    expect(it0.effect_status).toBe("unknown");
    const e = workEffect(it0);
    expect(e.kind).toBe("unknown");
    expect(JSON.stringify(e)).not.toContain("317");
  });
  it("null impact tolkes som null, ikke 0", () => {
    expect(parseWorkItems({ items: [{ ...base, impact_nok: null }] }).items[0].impact_nok).toBeNull();
  });
  it("verifisert prisavvik vises med verdi, også 0", () => {
    const [it0] = parseWorkItems({ items: [{ ...base, impact_nok: 0, effect_status: "verified_price_effect", read_integrity: "checked" }] }).items;
    expect(workEffect(it0)).toEqual({ kind: "verified", label: "Beregnet prisavvik", value: 0 });
  });
  it("usikker lesing vinner over verifisert status", () => {
    const [it0] = parseWorkItems({ items: [{ ...base, impact_nok: 500, effect_status: "verified_price_effect", read_integrity: "needs_review" }] }).items;
    expect(workEffect(it0).label).toBe("Kontroller lesingen");
  });
  it("ukjente verdier faller tilbake til unknown", () => {
    const [it0] = parseWorkItems({ items: [{ ...base, effect_status: "noe", read_integrity: "x" }] }).items;
    expect([it0.effect_status, it0.read_integrity]).toEqual(["unknown", "unknown"]);
  });
  it("tellertekst skiller leverandørvarer og fakturasaker", () => {
    const counts = { alle: 802, kobling: 354, pakning: 173, pris: 185, kontroll: 9, fakturaer: 81, faktura_mangler_linjer: 0, faktura_sumavvik: 0, faktura_flagget: 0, faktura_klar: 0 };
    expect(groupCountText("alle", counts)).toBe("721 leverandørvarer · 81 fakturasaker");
    expect(groupCountText("kobling", counts)).toBe("354 leverandørvarer");
    expect(groupCountText("fakturaer", counts)).toBe("81 fakturasaker");
  });
});

describe("sumkontroll og linjehenting", () => {
  it("bare eksplisitt gyldig status er kontrollert", () => {
    expect(sumOk("ok")).toBe(true);
    expect(sumOk("overridden")).toBe(true);
    for (const s of ["no_lines", "no_total", "not_checked", null, undefined, "mismatch", "noe"]) expect(sumOk(s)).toBe(false);
    expect(sumStatusLabel("not_checked")).toBe("Sum ikke kontrollert");
    expect(factsSummary({ lines_sum_status: "not_checked", lines_source: null, extraction_confidence: null })).toContain("Sum ikke kontrollert");
  });
  it("not_checked gir ikke steget «Kontrollert»", () => {
    const steps = deliverySteps({ status: "needs_review", received_at: null, line_count: 3, open_count: 0, lines_sum_status: "not_checked", lines_source: "pdf_extracted", line_extraction_status: "done" }, { approved: false, costPosted: false });
    expect(steps.find((s) => s.key === "kontrollert")?.done).toBe(false);
  });
  it("linjer hentes bare for tom faktura", () => {
    expect(canFetchLines({ source: "tripletex", line_extraction_status: "failed", line_count: 5 })).toBe(false);
    expect(canFetchLines({ source: "tripletex", line_extraction_status: "failed", line_count: 0 })).toBe(true);
  });
  it("rå AI-score er aldri «sikker» uten kontrollert sum", () => {
    const r = readingReliability({ confidence: 0.99, linesSumStatus: "not_checked" });
    expect(r.validated).toBe(false);
    expect(r.label).not.toMatch(/sikker/i);
  });
  it("PALS-tallene: differanse mellom lest sum og netto", () => {
    expect(controlFigures({ total_amount: 29652.45, total_vat: 3867.71, lines_sum_excl_vat: 343103.5 }).diff).toBe(317318.76);
  });
});
