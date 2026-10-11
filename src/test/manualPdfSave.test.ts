import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sanitizeLines } from "../../supabase/functions/_shared/invoiceExtraction.ts";
import { toInvoiceLineRows } from "../../supabase/functions/tripletex-import-invoice-lines/rows.ts";
import {
  lineFromExtraction, lineEdited, manualReading, manualSaveErrorMessage, parseManualSaveResult, rowPayload, validConfidence,
} from "@/fakturaer/lib/manualPdfSave";

// Tvetydig mengde («1.234» uten regnestykke som avgjør) gir lesevarsel og tallbevis fra den delte leseren.
const modelLine = { description: "Hvetemel 25kg", quantity: "1.234", unit: "sekk", unit_price: "10,00", total_amount: "99,00", confidence: 0.97 };

describe("manuell PDF: samme bevis som Tripletex-importen", () => {
  const [shared] = sanitizeLines([modelLine]);
  const manual = rowPayload(lineFromExtraction(shared), 0);
  const [tripletex] = toInvoiceLineRows([modelLine], "inv", null);

  it("bærer leserens lesevarsler og tallbevis uendret", () => {
    expect(shared.read_issues.length).toBeGreaterThan(0);
    expect(manual.read_issues.map((x) => x.code)).toEqual(shared.read_issues.map((x) => x.code));
    expect(manual.evidence?.number_evidence).toEqual(shared.number_evidence);
    expect(manual.evidence?.confidence).toBe(0.97);
  });

  it("bruker de samme feltnavnene som Tripletex-radene (det databasen leser)", () => {
    const tKeys = Object.keys(tripletex).filter((k) => k !== "invoice_id" && k !== "ledger_account").sort();
    expect(Object.keys(manual).sort()).toEqual(tKeys);
    expect(Object.keys(manual.evidence ?? {}).filter((k) => k !== "edited_by_user").sort()).toEqual(Object.keys(tripletex.evidence).sort());
  });

  it("RPC-en lagrer bevisfeltene med samme navn som Tripletex-finaliseringen", () => {
    const sql = readFileSync("supabase/tests/manual_pdf_atomic_save_regression.sql", "utf8");
    expect(sql).toContain("rm_save_manual_pdf_invoice");
    for (const k of ["read_issues", "number_evidence", "confidence"]) expect(sql).toContain(k);
  });

  it("merker linjer brukeren har endret, men beholder beviset", () => {
    const l = { ...lineFromExtraction(shared), quantity: 1234 };
    expect(lineEdited(l)).toBe(true);
    expect(rowPayload(l, 0).evidence?.edited_by_user).toBe(true);
    expect(rowPayload(l, 0).read_issues.length).toBeGreaterThan(0);
  });

  it("manuelt lagt til linje har ingen leserbevis", () => {
    const p = rowPayload({ description: "Ny", sku: null, quantity: 1, unit: null, unit_price: 1, total_amount: 1, vat_rate: null, package_size: null, package_unit: null, count_per_package: null }, 2);
    expect(p.evidence).toBeNull();
    expect(p.line_number).toBe(3);
  });
});

describe("manuell PDF: lesesikkerhet forblir ubekreftet uten validering", () => {
  const clean = lineFromExtraction({ description: "x", quantity: 1, unit_price: 5, total_amount: 5, confidence: 0.99 });
  it("rå 100 % uten kontrollert sum er ikke bekreftet", () => {
    const r = manualReading({ confidence: 1, linesSumStatus: "no_total", lines: [clean], invoiceIssues: 0 });
    expect(r.confirmed).toBe(false);
    expect(r.label).toMatch(/ikke bekreftet/i);
    expect(r.label).not.toMatch(/verifisert/i);
  });
  it("ugyldig sikkerhet (100) behandles som ukjent", () => {
    expect(validConfidence(100)).toBeNull();
    expect(manualReading({ confidence: 100, linesSumStatus: "ok", lines: [clean], invoiceIssues: 0 }).confirmed).toBe(false);
  });
  it("lesevarsler gir «Ikke bekreftet – lesevarsler»", () => {
    const [shared] = sanitizeLines([modelLine]);
    const r = manualReading({ confidence: 0.99, linesSumStatus: "ok", lines: [lineFromExtraction(shared)], invoiceIssues: 0 });
    expect(r.confirmed).toBe(false);
    expect(r.label).toBe("Ikke bekreftet – lesevarsler");
  });
  it("manglende linjescore hindrer bekreftelse", () => {
    const noConf = lineFromExtraction({ description: "x", quantity: 1, unit_price: 5, total_amount: 5 });
    expect(manualReading({ confidence: 0.95, linesSumStatus: "ok", lines: [noConf], invoiceIssues: 0 }).confirmed).toBe(false);
  });
  it("bekreftet bare når sum går opp, ingen varsler og høy gyldig sikkerhet", () => {
    expect(manualReading({ confidence: 0.95, linesSumStatus: "ok", lines: [clean], invoiceIssues: 0 }).confirmed).toBe(true);
  });
});

describe("manuell PDF: svar fra atomisk lagring", () => {
  it("tolker ok, nytt forsøk og duplikat", () => {
    expect(parseManualSaveResult({ ok: true, invoice_id: "a", supplier_id: "s", replayed: true, lines: 2, status: "needs_review" }))
      .toEqual({ ok: true, invoiceId: "a", supplierId: "s", replayed: true, status: "needs_review", lines: 2 });
    expect(parseManualSaveResult({ ok: false, code: "duplikat", invoice_id: "b" })).toEqual({ ok: false, code: "duplikat", invoiceId: "b" });
    expect(parseManualSaveResult(null)).toEqual({ ok: false, code: "ukjent_svar", invoiceId: null });
  });
  it("viser norske feiltekster, aldri rå koder", () => {
    expect(manualSaveErrorMessage("duplikat")).toMatch(/Ingenting ble lagret/);
    expect(manualSaveErrorMessage("noe_rart")).not.toContain("noe_rart");
  });
});
