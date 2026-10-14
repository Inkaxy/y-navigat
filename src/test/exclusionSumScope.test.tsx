// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { InvoiceDetailData } from "@/fakturaer/components/invoice-detail/fetchInvoiceDetail";

vi.mock("@/fakturaer/hooks/useInvoiceDocumentVersion", () => ({ useInvoiceDocumentVersion: () => ({ verifiedCurrent: null, isError: false, error: null, refetch: vi.fn(), accessScope: null }) }));
vi.mock("@/fakturaer/hooks/useInvoiceDocument", () => ({ useInvoiceDocumentUrl: () => ({ url: null, isLoading: false, error: null, refetch: vi.fn() }) }));
vi.mock("@/fakturaer/components/PdfDocumentViewer", () => ({ PdfDocumentViewer: () => null }));
vi.mock("@/fakturaer/components/InvoiceShareActions", () => ({ InvoiceShareActions: () => null }));
vi.mock("@/fakturaer/components/InvoiceDocumentButton", () => ({ InvoiceDocumentButton: () => null }));
vi.mock("@/fakturaer/components/invoice-detail/InvoiceFactsCard", () => ({ InvoiceFactsView: () => null }));
vi.mock("@/ravarer/pages/priskontroll/faktura/ReadIssuesBanner", () => ({ ReadIssuesBanner: () => null }));
vi.mock("@/ravarer/pages/priskontroll/faktura/InvoiceFactsSection", () => ({ headerFacts: () => ({}) }));

import { InvoiceDocumentPanel } from "@/fakturaer/components/InvoiceDocumentPanel";
import { ControlSummary } from "@/ravarer/pages/priskontroll/faktura/ControlSummary";

const inv = { invoice_number: "T-1", invoice_date: "2026-09-01", supplier_name: "Idun", source_document_url: "x.pdf", total_amount: 1250, total_vat: 250, lines_sum_status: "mismatch", lines_sum_excl_vat: 900, currency: "NOK" };
const line = { id: "l1", description: "Erstatning", quantity: 1, unit: "stk", unit_price: 100, total_amount: 100 };

const data = (status: string, excluded_at: string | null) => ({
  id: "inv", status, excluded_at, total_amount: 1250, total_vat: 250, lines_sum_excl_vat: 900, lines_sum_status: "mismatch", currency: "NOK",
  extraction_issues: [{ code: "x", message: "fakturavarsel" }], invoice_lines: [], line_extraction_status: "done",
}) as unknown as InvoiceDetailData;

describe("sumvarsel: hele dokumentet vs én utelatt linje", () => {
  it("dokument holdt utenfor: originalpanelet viser historisk sumvarsel og ikke prisgrunnlag", () => {
    render(<InvoiceDocumentPanel invoiceId="inv" invoice={inv} line={line as never} onClose={vi.fn()} showSumWarning lineHeldOutside documentHeldOutside />);
    expect(screen.getByText(/Historisk sumvarsel/)).toBeTruthy();
    expect(screen.queryByText(/Sjekk om en linje mangler/)).toBeNull();
    expect(screen.getByText(/ikke prisgrunnlag/)).toBeTruthy();
  });
  it("bare én linje utelatt, resten åpen: sumvarselet ber fortsatt om kontroll", () => {
    render(<InvoiceDocumentPanel invoiceId="inv" invoice={inv} line={line as never} onClose={vi.fn()} showSumWarning lineHeldOutside documentHeldOutside={false} />);
    expect(screen.getByText(/Sjekk om en linje mangler/)).toBeTruthy();
    expect(screen.queryByText(/Historisk sumvarsel/)).toBeNull();
    expect(screen.getByText(/ikke prisgrunnlag/)).toBeTruthy();
  });
  it("kontrollblokken: dokument holdt utenfor bevarer tallene uten ny oppgave", () => {
    render(<ControlSummary data={data("excluded", "2026-10-14T08:13:00Z")} openCount={2} totalCount={3} canWrite locked openSignal={0} />);
    expect(screen.getByText(/Historisk sumvarsel/)).toBeTruthy();
    expect(screen.getByText("Holdt utenfor")).toBeTruthy();
    expect(screen.queryByText(/Lesingen må kontrolleres/)).toBeNull();
    expect(screen.queryByText(/2 av 3 linjer/)).toBeNull();
    expect(screen.getByText(/900/)).toBeTruthy();
  });
  it("kontrollblokken: åpen faktura (én linje utelatt) viser fortsatt oppgaven", () => {
    render(<ControlSummary data={data("needs_review", null)} openCount={2} totalCount={3} canWrite locked={false} openSignal={0} />);
    expect(screen.queryByText(/Historisk sumvarsel/)).toBeNull();
    expect(screen.getByText(/Lesingen må kontrolleres/)).toBeTruthy();
    expect(screen.getByText(/2 av 3 linjer/)).toBeTruthy();
  });
});
