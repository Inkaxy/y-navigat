import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { linePriceGate, invoiceFigures, invoiceSourceLabel, toActionRequired } from "@/fakturaer/lib/financialPresentation";
import { InvoiceLinesTable } from "@/fakturaer/components/invoice-detail/InvoiceLinesTable";
import { InvoiceDocumentPanel } from "@/fakturaer/components/InvoiceDocumentPanel";
import { causeText, nextActionText } from "@/ravarer/pages/priskontroll/gjore/groupCopy";
import { workEffect } from "@/ravarer/lib/workEffect";
import { controlFigures } from "@/ravarer/pages/priskontroll/faktura/ControlSummary";
import type { InvoiceDetailLine } from "@/fakturaer/components/invoice-detail/fetchInvoiceDetail";

const okInv = { is_credit_note: false, currency: "NOK", lines_sum_status: "ok", flagged_at: null, extraction_issues: [] };
const okLine = { raw_material_id: "rm1", total_amount: 1000, quantity: 10, base_quantity: 100, price_per_base_unit: 10, expected_price_per_base_unit: 8, extraction_issues: [] };

describe("linePriceGate — felles regel", () => {
  it("verifisert normal NOK med kjent holdstatus kan sammenlignes", () => {
    expect(linePriceGate(okInv, okLine, false)).toEqual({ ok: true });
  });
  it("kreditnota er aldri en prisendring", () => {
    const g = linePriceGate({ ...okInv, is_credit_note: true }, { ...okLine, total_amount: -268885, price_per_base_unit: 2246 }, false);
    expect(g.ok).toBe(false);
    if (!g.ok) { expect(g.action).toBe("review_credit_note"); expect(g.label).toBe("Kontroller kreditnotaen"); }
  });
  it("EUR sammenlignes ikke med kronepriser", () => {
    const g = linePriceGate({ ...okInv, currency: "EUR" }, okLine, false);
    expect(!g.ok && g.action).toBe("review_currency");
  });
  it("holdt prisobservasjon krever bekreftet grunnlag, ukjent hold også", () => {
    expect(!linePriceGate(okInv, okLine, true).ok && linePriceGate(okInv, okLine, true)).toMatchObject({ reason: "price_observation_held", action: "confirm_price_basis" });
    expect(linePriceGate(okInv, okLine, null)).toMatchObject({ ok: false, reason: "hold_unknown" });
  });
  it("sumavvik / ikke kontrollert sum er kontrolloppgave", () => {
    expect(linePriceGate({ ...okInv, lines_sum_status: "mismatch" }, okLine, false)).toMatchObject({ ok: false, action: "review_reading" });
    expect(linePriceGate({ ...okInv, lines_sum_status: "not_checked" }, okLine, false)).toMatchObject({ ok: false, reason: "invoice_sum_not_verified" });
  });
  it("manglende pakning/grunnmengde og manglende kobling", () => {
    expect(linePriceGate(okInv, { ...okLine, base_quantity: null }, false)).toMatchObject({ ok: false });
    expect(linePriceGate(okInv, { ...okLine, raw_material_id: null }, false)).toMatchObject({ ok: false, action: "complete_link_or_package" });
  });
  it("lesevarsel på linje eller faktura", () => {
    expect(linePriceGate(okInv, { ...okLine, extraction_issues: [{ code: "x", message: "y" }] }, false)).toMatchObject({ ok: false, action: "review_reading" });
    expect(linePriceGate({ ...okInv, extraction_issues: [{ code: "x" }] }, okLine, false)).toMatchObject({ ok: false, reason: "invoice_read_unverified" });
  });
});

describe("invoiceFigures", () => {
  it("ukjent mva gir ukjent netto og differanse — ikke brutto som netto", () => {
    expect(invoiceFigures({ total_amount: 1250, total_vat: null, lines_sum_excl_vat: 1000 })).toMatchObject({ net: null, diff: null, gross: 1250 });
    expect(controlFigures({ total_amount: 1250, total_vat: null, lines_sum_excl_vat: 1000 })).toMatchObject({ net: null, diff: null });
  });
  it("eksplisitt mva 0 er avgiftsfritt", () => {
    expect(invoiceFigures({ total_amount: 1000, total_vat: 0, lines_sum_excl_vat: 1000 })).toMatchObject({ net: 1000, diff: 0 });
  });
  it("valuta følger fakturaen", () => {
    expect(invoiceFigures({ total_amount: 10, total_vat: 2, currency: "eur" }).currency).toBe("EUR");
  });
  it("kildelabel følger faktisk kilde", () => {
    expect(invoiceSourceLabel({ source: "pdf_upload" })).toBe("Fra manuelt importert PDF");
    expect(invoiceSourceLabel({ source: "tripletex" })).toBe("Fra Tripletex");
  });
});

describe("action_required i Å gjøre", () => {
  const base = { type: "varekort" as const, kind: "prisavvik" as const, open_lines: 1, open_invoices: 1 };
  it("kreditnota overstyrer «Pris avviker»", () => {
    const it2 = { ...base, action_required: toActionRequired("review_credit_note") };
    expect(causeText(it2)).toBe("Kreditnota – ikke en prisendring");
    expect(nextActionText(it2)).toBe("Kontroller kreditnotaen");
  });
  it("manglende kobling i prisgruppen kalles ikke lesefeil eller prisavvik", () => {
    expect(nextActionText({ kind: "prisavvik", action_required: "complete_link_or_package" })).toBe("Fullfør kobling eller pakning");
    const e = workEffect({ effect_status: "unknown", effect_label: null, impact_nok: null, read_integrity: "needs_review", unknown_effect_lines: 1, action_required: "complete_link_or_package" });
    expect(e.label).toBe("Fullfør kobling eller pakning");
  });
  it("eldre server uten feltet beholder kind-tekst", () => {
    expect(nextActionText({ kind: "prisavvik", action_required: null })).toBe("Vurder pris");
  });
});

function line(over: Partial<InvoiceDetailLine>): InvoiceDetailLine {
  return {
    id: "l1", invoice_id: "i1", line_number: 1, supplier_sku: "A1", description: "Combisur", quantity: 10, unit: "sekk", unit_price: -26888.5,
    total_amount: -268885, raw_material_id: "rm1", raw_materials: { id: "rm1", name: "Combisur", sku: null }, price_per_base_unit: 2246, expected_price_per_base_unit: 10,
    base_quantity: 100, price_variance_pct: 22377.2, match_confidence: "manual", review_reason: null, line_kind: null, resolution_note: null, extraction_issues: [], ledger_account: null,
    ...over,
  } as InvoiceDetailLine;
}
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
const tableProps = { supplierId: "s1", canBulkImport: false, canMatch: false, selected: {}, onSelect: () => undefined, showLedgerAccount: false, onShowLedgerAccount: () => undefined, onMatch: () => undefined, onRegister: () => undefined, tolerancePct: 3, settings: null };

describe("faktiske komponenter", () => {
  it("tabell: kreditnota viser ingen prosent, bare kontrolloppgave og originalbeløp", () => {
    wrap(<InvoiceLinesTable {...tableProps} lines={[line({})]} invoice={{ ...okInv, is_credit_note: true }} heldFor={() => false} />);
    expect(screen.queryByText(/22\s?377/)).toBeNull();
    expect(screen.getByText("Kontroller kreditnotaen")).toBeInTheDocument();
    expect(screen.getAllByText(/268\s?885/).length).toBeGreaterThan(0);
  });
  it("tabell mobil (preferanse tabell=true): kort i stedet for bred tabell, EUR i riktig valuta", () => {
    wrap(<InvoiceLinesTable {...tableProps} compact lines={[line({ total_amount: 500, unit_price: 50 })]} invoice={{ ...okInv, currency: "EUR" }} heldFor={() => false} />);
    expect(document.querySelector("table")).toBeNull();
    expect(screen.getAllByText(/€/).length).toBeGreaterThan(0);
    expect(screen.getByText("Kontroller valuta")).toBeInTheDocument();
  });
  it("dokumentpanel: kreditnota uten prisavvik, ingen rå score-banner", () => {
    wrap(<InvoiceDocumentPanel onClose={() => undefined}
      invoice={{ invoice_number: "8050625", invoice_date: "2026-10-01", is_credit_note: true, currency: "NOK", lines_sum_status: "ok", extraction_confidence: 1, total_amount: -268885, total_vat: null }}
      line={line({})} held={false} />);
    expect(screen.queryByText(/22\s?377/)).toBeNull();
    expect(screen.queryByText(/100 %/)).toBeNull();
    expect(screen.getByText(/Kontroller kreditnotaen — prisavvik vises ikke/)).toBeInTheDocument();
  });
  it("dokumentpanel: verifisert normal NOK viser sammenligning", () => {
    wrap(<InvoiceDocumentPanel onClose={() => undefined}
      invoice={{ invoice_number: "1", invoice_date: "2026-10-01", is_credit_note: false, currency: "NOK", lines_sum_status: "ok", extraction_issues: [] }}
      line={line({ total_amount: 1000, unit_price: 100, price_per_base_unit: 10, expected_price_per_base_unit: 8, price_variance_pct: 25 })} held={false} />);
    expect(screen.getByText(/\+25 %/)).toBeInTheDocument();
  });
});
