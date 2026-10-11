import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  clampConfidence, lineReadIssues, overallConfidence, parseNorwegianNumber, shouldRetryExtraction, vatRatioIssue, type ReadLine,
} from "@/fakturaer/lib/invoiceReadCheck";
import { buildChanges, correctionErrorMessage, correctionLockReason, draftFrom, parseCorrectionResult, parseReadIssues, type CorrectionValues } from "@/fakturaer/lib/lineCorrection";
import { buildSupplierCaseDraft, outboxState } from "@/fakturaer/lib/supplierCaseDraft";
import { costProgress, deliverySteps, extrasFromCounts, nextInvoiceStep, type NextStepInput } from "@/ravarer/pages/priskontroll/faktura/invoiceSteps";
import { canPostCosts } from "@/ravarer/pages/priskontroll/godkjenning/approvalLogic";

const line = (p: Partial<ReadLine>): ReadLine => ({ quantity: null, unit: null, unit_price: null, total_amount: null, package_size: null, package_unit: null, count_per_package: null, ...p });

describe("delt lesekontroll", () => {
  it("er byte-identisk mellom nettleser og edge (_shared)", () => {
    expect(readFileSync("supabase/functions/_shared/invoiceReadCheck.ts", "utf8")).toBe(readFileSync("src/fakturaer/lib/invoiceReadCheck.ts", "utf8"));
  });
});

describe("norske tall", () => {
  it.each([
    ["1 234 567,89", 1234567.89], ["1.234,50", 1234.5], ["12,5 kr", 12.5], ["-12,5", -12.5], ["1,234.50", 1234.5],
    ["1.234.567", 1234567], ["1.234", 1234], ["0,95", 0.95], ["kr 98 400,00", 98400], [" 7 ", 7],
  ])("%s → %s", (s, n) => expect(parseNorwegianNumber(s)).toBe(n));
  it.each(["abc", "", "1,2,3x", "NaN", "Infinity"])("ugyldig «%s» → null", (s) => expect(parseNorwegianNumber(s)).toBeNull());
  it("ikke-endelige tall avvises", () => expect(parseNorwegianNumber(Number.POSITIVE_INFINITY)).toBeNull());
});

describe("sikkerhet 0–1", () => {
  it("begrenses og ugyldige blir ukjent", () => {
    expect(clampConfidence(1.7)).toBe(1);
    expect(clampConfidence(-0.2)).toBe(0);
    expect(clampConfidence("0,8")).toBe(0.8);
    expect(clampConfidence("høy")).toBeNull();
    expect(clampConfidence(Number.NaN)).toBeNull();
  });
  it("høy sikkerhet på header frikjenner ikke en usikker linje", () => {
    expect(overallConfidence([0.99, 0.98, 1], [0.95, 0.3])).toBe(0.3);
    expect(overallConfidence([0.9], [])).toBe(0.9);
    expect(overallConfidence([5, "x"], [])).toBe(1);
  });
});

describe("regnestykke per linje (speiler rm_line_read_issues)", () => {
  it("36x90g: pris per eske", () => expect(lineReadIssues(line({ quantity: 1, unit: "eske", unit_price: 97.2, total_amount: 97.2, package_size: 90, package_unit: "g", count_per_package: 36 }))).toEqual([]));
  it("36x90g: pris per kg (3,24 kg × 30)", () => expect(lineReadIssues(line({ quantity: 1, unit: "eske", unit_price: 30, total_amount: 97.2, package_size: 90, package_unit: "g", count_per_package: 36 }))).toEqual([]));
  it("96 kg fakturert, pris per 2 kg-spann", () => expect(lineReadIssues(line({ quantity: 96, unit: "kg", unit_price: 90, total_amount: 4320, package_size: 2, package_unit: "kg" }))).toEqual([]));
  it("500 ml-flasker, pris per liter", () => expect(lineReadIssues(line({ quantity: 8, unit: "stk", unit_price: 40, total_amount: 160, package_size: 500, package_unit: "ml" }))).toEqual([]));
  it("store norske tall", () => expect(lineReadIssues(line({ quantity: 1200, unit: "kg", unit_price: 82.5, total_amount: parseNorwegianNumber("99 000,00") }))).toEqual([]));
  it("rabatt uten egen linje varsles som mulig rabatt", () => expect(lineReadIssues(line({ quantity: 10, unit_price: 100, total_amount: 900 }))[0].code).toBe("mulig_rabatt"));
  it("feillest linjesum", () => expect(lineReadIssues(line({ quantity: 3, unit_price: 100, total_amount: 30 }))[0].code).toBe("regnestykke"));
  it("kreditnota med negative tall", () => expect(lineReadIssues(line({ quantity: -2, unit_price: 50, total_amount: -100 }))).toEqual([]));
  it("mengde 0 med beløp", () => expect(lineReadIssues(line({ quantity: 0, unit_price: 50, total_amount: 100 }))[0].code).toBe("mengde_null"));
  it("manglende linjesum", () => expect(lineReadIssues(line({ quantity: 1, unit_price: 50 }))[0].code).toBe("linjesum_mangler"));
  it("frakt med bare sum kontrolleres ikke", () => expect(lineReadIssues(line({ total_amount: 150 }))).toEqual([]));
});

describe("sumavvik med mva-forhold skaleres aldri", () => {
  it("manglende linje som tilfeldig gir 1/1,25 varsles som kontroll, ikke omskriving", () => {
    // 1000 eks. mva, men bare 800 lest: én linje på 200 mangler.
    const i = vatRatioIssue(800, 1250, 250);
    expect(i?.code).toBe("sumavvik_mva_forhold");
    expect(i?.message).toMatch(/manglende linje/);
    expect(i?.message).toMatch(/Ingen beløp er endret/);
  });
  it("linjer lest inkl. mva (×1,25) varsles", () => expect(vatRatioIssue(1250, 1250, 250)?.code).toBe("sumavvik_mva_forhold"));
  it("riktig sum gir ingen varsel", () => expect(vatRatioIssue(1000, 1250, 250)).toBeNull());
  it("tilfeldig avvik er vanlig sumavvik, ikke mva-forhold", () => expect(vatRatioIssue(700, 1250, 250)).toBeNull());
});

describe("tomt resultat", () => {
  it("0 linjer i første forsøk gir nytt forsøk, ikke ferdig", () => {
    expect(shouldRetryExtraction([], 1)).toBe(true);
    expect(shouldRetryExtraction(undefined, 1)).toBe(true);
    expect(shouldRetryExtraction([], 2)).toBe(false);
    expect(shouldRetryExtraction([{}], 1)).toBe(false);
  });
});

const orig: CorrectionValues = { supplier_sku: "123", description: "SMØR 10KG", quantity: 3, unit: "stk", package_size: 10, package_unit: "kg", count_per_package: null, unit_price: 100, total_amount: 30, line_kind: "vare" };

describe("Rett fakturalinje", () => {
  it("sender bare endrede felt, med norske tall", () => {
    const d = { ...draftFrom(orig), total_amount: "300,00" };
    expect(buildChanges(orig, d)).toEqual({ changes: { total_amount: 300 }, errors: {} });
  });
  it("uendret skjema gir ingen endringer", () => expect(buildChanges(orig, draftFrom(orig)).changes).toEqual({}));
  it("ugyldig tall og pakning 0 gir feil per felt", () => {
    const r = buildChanges(orig, { ...draftFrom(orig), quantity: "tre", package_size: "0" });
    expect(r.errors.quantity).toBeTruthy();
    expect(r.errors.package_size).toBeTruthy();
  });
  it("låste linjer: avstemt, godkjent, kostpris ført", () => {
    expect(correctionLockReason({ status: "reconciled", approved: false, costPosted: false })).toMatch(/avstemt/);
    expect(correctionLockReason({ status: "ready", approved: true, costPosted: false })).toMatch(/godkjent/);
    expect(correctionLockReason({ status: "ready", approved: false, costPosted: true })).toMatch(/Kostpris/);
    expect(correctionLockReason({ status: "needs_review", approved: false, costPosted: false })).toBeNull();
  });
  it("serverfeil vises på norsk, aldri rått", () => {
    expect(correctionErrorMessage("versjon_endret: x")).toMatch(/endret siden du åpnet/);
    expect(correctionErrorMessage("forbidden: Mangler")).toMatch(/skrivetilgang/);
    expect(correctionErrorMessage("kostpris_fort: x")).toMatch(/Kostpris er ført/);
    expect(correctionErrorMessage("faktura_godkjent: x")).toMatch(/godkjent/);
    expect(correctionErrorMessage("relation foo does not exist")).toBe("Rettelsen ble ikke lagret. Prøv igjen.");
  });
  it("leser svaret typet", () => {
    const r = parseCorrectionResult({ ok: true, changed: ["total_amount"], remaining_issues: [{ code: "mulig_rabatt", message: "m" }], example_id: "e1", lines_sum_status: "mismatch" });
    expect(r).toEqual({ ok: true, changed: ["total_amount"], remainingIssues: [{ code: "mulig_rabatt", message: "m" }], exampleId: "e1", linesSumStatus: "mismatch" });
    expect(parseReadIssues("x")).toEqual([]);
  });
});

describe("e-postkladd for leverandørsak", () => {
  const input = {
    supplier_name: "Mølleriet AS", case_title: "Prisøkning mel", credited: 100,
    lines: [
      { invoice_number: "4711", invoice_date: "2026-09-03", item: "Hvetemel", quantity: 250, unit: "kg", expected: 8.2, invoiced: 9, amount_excl_vat: 200 },
      { invoice_number: "4712", invoice_date: null, item: "Rugmel <b>", quantity: null, unit: "kg", expected: null, invoiced: 11, amount_excl_vat: 50 },
    ],
  };
  it("har leverandør, fakturanr/dato, lik enhet, avvik, kreditert og rest", () => {
    const d = buildSupplierCaseDraft(input);
    expect(d.subject).toContain("4711, 4712");
    expect(d.body).toContain("Hei Mølleriet AS,");
    expect(d.body).toContain("03.09.2026");
    expect(d.body).toMatch(/forventet 8,20 kr\/kg, fakturert 9,00 kr\/kg/);
    expect(d.body).toContain("Samlet avvik: 250,00 kr eks. mva.");
    expect(d.body).toContain("Allerede kreditert: 100,00");
    expect(d.body).toContain("Gjenstår: 150,00");
  });
  it("manglende avtalegrunnlag sies ærlig", () => {
    const d = buildSupplierCaseDraft(input);
    expect(d.missingBasis).toBe(true);
    expect(d.body).toMatch(/ikke dokumentert avtalt pris/);
    expect(d.body).toContain("forventet pris ikke dokumentert");
  });
  it("teksten er ren tekst (serveren escaper ved utsending)", () => expect(buildSupplierCaseDraft(input).body).toContain("Rugmel <b>"));
  it("utsendingsstatus: i kø vs sendt vs feilet", () => {
    expect(outboxState(null)).toBe("ikke_sendt");
    expect(outboxState("pending")).toBe("i_ko");
    expect(outboxState("sending")).toBe("i_ko");
    expect(outboxState("sent")).toBe("sendt");
    expect(outboxState("failed")).toBe("feilet");
  });
});

const base: NextStepInput = {
  status: "needs_review", received_at: "2026-10-01", line_count: 3, lines_source: "pdf_extracted", line_extraction_status: "done",
  open_count: 0, lines_sum_status: "ok", reconciled_mode: null, approved: false, costPosted: false, source: "tripletex",
  canReconcile: true, reconcileBlockedReason: null, canWrite: true, canReconcileRight: true, canApprove: true, canPostCosts: true,
};

describe("delvis kostprisføring (3C)", () => {
  it("teller ingen/delvis/fullført", () => {
    expect(costProgress(0, 3).state).toBe("ingen");
    expect(costProgress(1, 3)).toEqual({ state: "delvis", posted: 1, total: 3, remaining: 2 });
    expect(costProgress(3, 3).state).toBe("fullfort");
    expect(extrasFromCounts(false, 1, 3).costPosted).toBe(false);
  });
  it("delvis → avklaring → resten → avstem", () => {
    // 1 av 3 ført, én linje fortsatt åpen: avklar først.
    const s1 = { ...base, ...extrasFromCounts(false, 1, 3), open_count: 1 };
    expect(nextInvoiceStep(s1).key).toBe("avklar");
    // Avklart: resten kan føres.
    const s2 = { ...s1, open_count: 0 };
    const n2 = nextInvoiceStep(s2);
    expect(n2.key).toBe("kostpris");
    expect(n2.label).toBe("Før kostpris for resten (2 gjenstår)");
    // Alt ført: neste er avstemming.
    expect(nextInvoiceStep({ ...s2, ...extrasFromCounts(false, 3, 3) }).key).toBe("avstem");
  });
  it("tidslinjen viser delvis med antall og er ikke ferdig", () => {
    const k = deliverySteps(base, extrasFromCounts(false, 1, 3)).find((s) => s.key === "kostpris");
    expect(k?.done).toBe(false);
    expect(k?.detail).toMatch(/Delvis ført: 1 av 3/);
    const f = deliverySteps(base, extrasFromCounts(false, 3, 3)).find((s) => s.key === "kostpris");
    expect(f?.done).toBe(true);
  });
  it("Godkjenning: delvis ført kan fortsatt føres", () => {
    const r = { status: "ready", is_credit_note: false, cost_posted_lines: 1, cost_line_total: 3 };
    expect(canPostCosts(r)).toBe(true);
    expect(canPostCosts({ ...r, cost_posted_lines: 3 })).toBe(false);
    expect(canPostCosts({ ...r, is_credit_note: true })).toBe(false);
  });
  it("avstemt etter delvis føring: ferdig med delvis-merknad", () => {
    const n = nextInvoiceStep({ ...base, status: "reconciled", approved: true, ...extrasFromCounts(true, 1, 3) });
    expect(n.key).toBe("ferdig");
    expect(n.hint).toMatch(/delvis ført \(1 av 3/);
  });
});
