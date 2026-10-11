// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
vi.mock("@/fakturaer/components/PdfDocumentViewer", () => ({ PdfDocumentViewer: () => null }));
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoiceFigures, invoiceSourceLabel, toActionRequired } from "@/fakturaer/lib/financialPresentation";
import { parsePriceSafety, safetyGate, totalEffect } from "@/fakturaer/lib/priceSafety";
import { KIND_COPY, parseClaimPreview, planClaim } from "@/ravarer/lib/supplierClaim";
import { InvoiceLinesTable } from "@/fakturaer/components/invoice-detail/InvoiceLinesTable";
import { InvoiceDocumentPanel } from "@/fakturaer/components/InvoiceDocumentPanel";
import { causeText, nextActionText } from "@/ravarer/pages/priskontroll/gjore/groupCopy";
import { workEffect } from "@/ravarer/lib/workEffect";
import { controlFigures } from "@/ravarer/pages/priskontroll/faktura/ControlSummary";
import type { InvoiceDetailLine } from "@/fakturaer/components/invoice-detail/fetchInvoiceDetail";

const okInv = { currency: "NOK" };
const safeLine = (over: Record<string, unknown> = {}) => ({ line_id: "l1", line_version: "2026-10-11T10:00:00Z", raw_material_id: "rm1", can_compare: true, effect_nok: 200,
  reason_code: null, reference_source: "agreement", reference_id: "a1", expected_price_per_base_unit: 8, price_per_base_unit: 10, base_quantity: 100, ...over });
const resp = (lines: unknown[]) => ({ invoice_id: "i1", checked_at: "2026-10-11T10:00:01Z", lines });
const gateOf = (raw: Record<string, unknown>, fresh = true, ver: string | null = "2026-10-11T10:00:00Z") => safetyGate(parsePriceSafety(resp([raw]), "i1")?.lines.get("l1"), fresh, ver);

describe("autoritativ prisstatus (rm_invoice_line_price_safety)", () => {
  it("godkjent linje fra serveren kan sammenlignes; 0 er kontrollert uten avvik", () => {
    expect(gateOf(safeLine()).ok).toBe(true);
    const z = gateOf(safeLine({ effect_nok: 0, price_per_base_unit: 8 }));
    expect(z.ok && z.safety.effect_nok).toBe(0);
  });
  it.each(["credit_note", "non_nok_currency", "cancelled_invoice", "line_needs_review", "invalid_tenant_link", "package_not_confirmed", "base_quantity_conflicts", "price_observation_held", "price_reference_unverified", "invoice_sum_not_verified", "noe_nytt"])(
    "%s gir aldri sammenligning eller virkning", (code) => {
      const g = gateOf(safeLine({ can_compare: false, reason_code: code, effect_nok: null }));
      expect(g.ok).toBe(false);
    });
  it("kreditnota-etikett sier ikke prisendring", () => {
    const g = gateOf(safeLine({ can_compare: false, reason_code: "credit_note", effect_nok: null }));
    expect(!g.ok && g.label).toBe("Kreditnota – ikke sammenlignbar varepris");
  });
  it("lasting/feil/utdatert, manglende linje, feil faktura og versjonsavvik er ukjent selv med lagret godkjenning", () => {
    expect(gateOf(safeLine(), false).ok).toBe(false);
    expect(safetyGate(undefined, true).ok).toBe(false);
    expect(parsePriceSafety(resp([safeLine()]), "annen")).toBeNull();
    expect(gateOf(safeLine(), true, "2026-10-11T10:05:00Z").ok).toBe(false);
  });
  it("ugyldig form er ukjent: negativ/tekst-virkning, godkjent uten virkning", () => {
    expect(gateOf(safeLine({ effect_nok: -1 })).ok).toBe(false);
    expect(gateOf(safeLine({ effect_nok: "200" })).ok).toBe(false);
    expect(gateOf(safeLine({ effect_nok: null })).ok).toBe(false);
    expect(gateOf(safeLine({ can_compare: "true" })).ok).toBe(false);
  });
  it("totalsum bare når alle linjer er godkjent", () => {
    expect(totalEffect([gateOf(safeLine()), gateOf(safeLine({ effect_nok: 50 }))])).toBe(250);
    expect(totalEffect([gateOf(safeLine()), gateOf(safeLine(), false)])).toBeNull();
    expect(totalEffect([])).toBeNull();
  });
});

describe("krav vs prisforespørsel (rm_supplier_claim_preview)", () => {
  const claim = (id: string, kind: string, amount: number, obs: number | null = amount) => ({ line_id: id, eligible: true, basis: { case_kind: kind, amount_excl_vat: amount, observed_effect_excl_vat: obs, price_per_base_unit: 10 } });
  it("dokumentert krav summerer serverens beløp og sender grunnlaget uendret", () => {
    const pl = planClaim(parseClaimPreview({ lines: [claim("a", "documented_claim", 100), claim("b", "documented_claim", 50.5)] }, ["a", "b"]));
    expect(pl).toMatchObject({ ok: true, kind: "documented_claim", amount: 150.5 });
    expect(pl.ok && pl.lines[0].basis).toMatchObject({ case_kind: "documented_claim" });
  });
  it("prisforespørsel krever null kroner", () => {
    const pl = planClaim(parseClaimPreview({ lines: [claim("a", "price_inquiry", 0, 120)] }, ["a"]));
    expect(pl).toMatchObject({ ok: true, kind: "price_inquiry", amount: 0, observed: 120 });
    expect(planClaim(parseClaimPreview({ lines: [claim("a", "price_inquiry", 120)] }, ["a"])).ok).toBe(false);
  });
  it("blandet type må deles, manglende/ikke brukbar linje stopper alt", () => {
    expect(planClaim(parseClaimPreview({ lines: [claim("a", "documented_claim", 1), claim("b", "price_inquiry", 0)] }, ["a", "b"]))).toMatchObject({ ok: false, code: "mixed" });
    expect(planClaim(parseClaimPreview({ lines: [claim("a", "documented_claim", 1)] }, ["a", "b"]))).toMatchObject({ ok: false, code: "ineligible" });
    const cr = planClaim(parseClaimPreview({ lines: [{ line_id: "a", eligible: false, reason: "claim_unverified:credit_note" }] }, ["a"]));
    expect(!cr.ok && cr.reasons).toEqual(["Kreditnota – ikke en prisendring"]);
  });
  it("kopi skiller krav fra forespørsel", () => {
    expect(KIND_COPY.price_inquiry.action).not.toMatch(/kreditt|krav/i);
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
    wrap(<InvoiceLinesTable {...tableProps} lines={[line({})]} invoice={okInv} gateOf={() => gateOf(safeLine({ can_compare: false, reason_code: "credit_note", effect_nok: null }))} />);
    expect(screen.queryByText(/22\s?377/)).toBeNull();
    expect(screen.getAllByText(/Kreditnota/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/268\s?885/).length).toBeGreaterThan(0);
  });
  it("tabell mobil (preferanse tabell=true): kort i stedet for bred tabell, EUR i riktig valuta", () => {
    wrap(<InvoiceLinesTable {...tableProps} compact lines={[line({ total_amount: 500, unit_price: 50 })]} invoice={{ currency: "EUR" }} gateOf={() => gateOf(safeLine({ can_compare: false, reason_code: "non_nok_currency", effect_nok: null }))} />);
    expect(document.querySelector("table")).toBeNull();
    expect(screen.getAllByText(/€/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Valuta må avklares/).length).toBeGreaterThan(0);
  });
  it("dokumentpanel: kreditnota uten prisavvik, ingen rå score-banner", () => {
    wrap(<InvoiceDocumentPanel onClose={() => undefined}
      invoice={{ invoice_number: "8050625", invoice_date: "2026-10-01", is_credit_note: true, currency: "NOK", lines_sum_status: "ok", extraction_confidence: 1, total_amount: -268885, total_vat: null }}
      line={line({})} gate={gateOf(safeLine({ can_compare: false, reason_code: "credit_note", effect_nok: null }))} />);
    expect(screen.queryByText(/22\s?377/)).toBeNull();
    expect(screen.queryByText(/100 %/)).toBeNull();
    expect(screen.getAllByText(/Kreditnota/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Prisen avviker|Se over pris/)).toBeNull();
  });
  it("dokumentpanel: ukjent status (lasting/feil) viser ingen prosent selv om linjen har lagret avvik", () => {
    wrap(<InvoiceDocumentPanel onClose={() => undefined}
      invoice={{ invoice_number: "1", invoice_date: "2026-10-01", is_credit_note: false, currency: "NOK", lines_sum_status: "ok", extraction_issues: [] }}
      line={line({ total_amount: 1000, unit_price: 100, price_per_base_unit: 10, expected_price_per_base_unit: 8, price_variance_pct: 25 })} gate={gateOf(safeLine(), false)} />);
    expect(screen.queryByText(/\+25 %/)).toBeNull();
  });
  it("dokumentpanel: verifisert normal NOK viser sammenligning", () => {
    wrap(<InvoiceDocumentPanel onClose={() => undefined}
      invoice={{ invoice_number: "1", invoice_date: "2026-10-01", is_credit_note: false, currency: "NOK", lines_sum_status: "ok", extraction_issues: [] }}
      line={line({ total_amount: 1000, unit_price: 100, price_per_base_unit: 10, expected_price_per_base_unit: 8, price_variance_pct: 25 })} gate={gateOf(safeLine({ effect_nok: 200, expected_price_per_base_unit: 8, price_per_base_unit: 10 }))} />);
    expect(screen.getByText(/\+25 %/)).toBeInTheDocument();
  });
});

describe("varekort: bare serverkontrollerte linjer", () => {
  it("kreditnota, ukjent status og verifisert avvik skilles; ingen lokal regel godkjenner", async () => {
    const { splitByGate } = await import("@/ravarer/pages/priskontroll/gjore/PriceBlock");
    const base = { invoice_number: "1", invoice_date: "2026-10-01", quantity: 1, unit: "kg", price_per_base_unit: 9999, expected_price_per_base_unit: 1 };
    const lines = [{ ...base, id: "a", invoice_id: "i1" }, { ...base, id: "b", invoice_id: "i1" }, { ...base, id: "c", invoice_id: "i2" }] as unknown as Parameters<typeof splitByGate>[0];
    const gates: Record<string, ReturnType<typeof gateOf>> = {
      a: gateOf(safeLine({ line_id: "l1" })),
      b: gateOf(safeLine({ can_compare: false, reason_code: "credit_note", effect_nok: null })),
      c: gateOf(safeLine(), false),
    };
    const r = splitByGate(lines, (l) => gates[l.id]);
    expect(r.rows.map((x) => [x.id, x.price_per_base_unit, x.effect_nok])).toEqual([["a", 10, 200]]);
    expect(r.blocked.map((x) => x.label)).toEqual(["Kreditnota – ikke sammenlignbar varepris", "Prisgrunnlag ikke kontrollert"]);
  });
});

describe("PDF-identitet", () => {
  it("nytt innhold under samme sti gir ny identitet (side/zoom nullstilles)", async () => {
    const { documentIdentity } = await vi.importActual<typeof import("@/fakturaer/components/PdfDocumentViewer")>("@/fakturaer/components/PdfDocumentViewer").catch(() => ({ documentIdentity: (a: string, b: string | null | undefined, c: string) => `${a}|${b ?? ""}|${c}` }));
    expect(documentIdentity("a.pdf", null, "x")).not.toBe(documentIdentity("a.pdf", null, "y"));
    expect(documentIdentity("a.pdf", "v1", "x")).not.toBe(documentIdentity("a.pdf", "v2", "x"));
  });
});
