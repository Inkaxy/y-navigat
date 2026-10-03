// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { assessInboxInvoice, inboxPrimaryAction, inboxTabOf, type InboxLine } from "@/fakturaer/lib/inbox";
import { matchesInboxSearch, type InboxInvoice } from "@/fakturaer/hooks/useInboxInvoices";
import { reconcileAcceptance } from "../../supabase/functions/_shared/priceAcceptance";
import { packageDisagreement, pickSupplierLink, suggestPackage } from "@/fakturaer/lib/packageDraft";
import { acceptPriceErrorMessage } from "@/fakturaer/lib/queueActions";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } } }));

const L = (o: Partial<InboxLine> = {}): InboxLine => ({
  raw_material_id: "rm",
  requires_review: false,
  review_reason: null,
  match_confidence: "manual",
  price_per_base_unit: 10,
  price_variance_pct: null,
  variance_status: null,
  category: null,
  ...o,
});
const base = { status: "needs_review", is_credit_note: false, lines_sum_status: "ok", notes: null };

describe("innboksvurdering følger serverens tilstand", () => {
  it("klar faktura havner i «Klar» selv om lagret status ikke er oppdatert", () => {
    const a = assessInboxInvoice({ ...base, lines: [L(), L()] });
    expect(a.canReconcile).toBe(true);
    expect(inboxTabOf({ status: "needs_review", assessment: a })).toBe("ready");
  });
  it("ikke-råvare uten kobling teller som avklart", () => {
    const a = assessInboxInvoice({ ...base, lines: [L(), L({ raw_material_id: null, match_confidence: "not_applicable" })] });
    expect(a.unmatchedCount).toBe(0);
    expect(a.canReconcile).toBe(true);
  });
  it("godtatt prisavvik gir ikke prisavvik-merke selv med stor prosent", () => {
    const a = assessInboxInvoice({ ...base, lines: [L({ price_variance_pct: 49, variance_status: "over_tolerance" })] });
    expect(a.issues).not.toContain("price_variance");
    expect(a.canReconcile).toBe(true);
  });
  it("åpent prisavvik fra serveren blokkerer", () => {
    const a = assessInboxInvoice({ ...base, lines: [L({ requires_review: true, review_reason: "price_variance" })] });
    expect(a.issues).toContain("price_variance");
    expect(a.canReconcile).toBe(false);
  });
  it("fakturanivå blokkerer fullføring selv når alle linjer er avklart", () => {
    expect(assessInboxInvoice({ ...base, lines_sum_status: "mismatch", lines: [L()] }).canReconcile).toBe(false);
    expect(assessInboxInvoice({ ...base, lines_sum_status: null, lines: [L()] }).canReconcile).toBe(false);
    expect(assessInboxInvoice({ ...base, line_extraction_status: "pending", lines: [L()] }).canReconcile).toBe(false);
    expect(assessInboxInvoice({ ...base, is_credit_note: true, lines: [L()] }).canReconcile).toBe(false);
    expect(assessInboxInvoice({ ...base, lines: [] }).canReconcile).toBe(false);
    expect(assessInboxInvoice({ ...base, status: "flagged", lines: [L()] }).canReconcile).toBe(false);
  });
  it("én meningsfull handling per rad", () => {
    const open = assessInboxInvoice({ ...base, lines: [L({ raw_material_id: null, requires_review: true, review_reason: "unmatched" }), L(), L({ requires_review: true, review_reason: "unknown_package_size" })] });
    const r = { status: "needs_review", source: "ehf", line_count: 3, line_extraction_status: "done", assessment: open };
    expect(inboxPrimaryAction(r).label).toBe("Avklar 2 punkter");
    const ready = assessInboxInvoice({ ...base, lines: [L()] });
    expect(inboxPrimaryAction({ ...r, line_count: 1, assessment: ready }).label).toBe("Fullfør kontroll");
    expect(inboxPrimaryAction({ ...r, source: "tripletex", line_count: 0, assessment: open }).label).toBe("Hent linjer");
  });
  it("søk treffer leverandør og fakturanummer", () => {
    const inv = { invoice_number: "330702353", supplier_name: "ASKO Øst" };
    expect(matchesInboxSearch(inv, "asko")).toBe(true);
    expect(matchesInboxSearch(inv, "3307")).toBe(true);
    expect(matchesInboxSearch(inv, "tine")).toBe(false);
  });
});

describe("varig prisaksept i matchemotoren", () => {
  const acc = {
    raw_material_id: "rm", quantity: 6, unit: "kg", unit_price: 35.54, total_amount: 213.24,
    price_per_base_unit: 35.54, expected_price_per_base_unit: 23.82, price_reference_source: "agreement",
    price_reference_id: "ref", price_reference_date: "2026-09-01", accepted_reasons: ["price_variance"],
  };
  const line = { quantity: 6, unit: "kg", unit_price: 35.54, total_amount: 213.24, price_acceptance: acc, resolution_note: "Prisavvik godtatt", resolved_by: "u1", resolved_at: "t" };
  const target = (o: Record<string, unknown> = {}) => ({
    requires_review: true, review_reason: "price_variance", price_per_base_unit: 35.54, expected_price_per_base_unit: 23.82,
    price_reference_source: "agreement", price_reference_id: "ref", price_reference_date: "2026-09-01",
    resolution_note: null, resolved_by: null, resolved_at: null, ...o,
  });

  it("samme grunnlag ved ny matching beholder godkjenningen og hvem/når", () => {
    const t = target();
    reconcileAcceptance(line, t, "rm");
    expect(t.requires_review).toBe(false);
    expect(t.review_reason).toBeNull();
    expect(t.resolved_by).toBe("u1");
    expect("price_acceptance" in t).toBe(false);
  });
  it("endret beløp åpner avviket igjen", () => {
    const t = target();
    reconcileAcceptance({ ...line, total_amount: 300 }, t, "rm");
    expect(t.requires_review).toBe(true);
    expect((t as Record<string, unknown>).price_acceptance).toBeNull();
  });
  it("endret prisreferanse, pakning (pris per enhet) eller råvare åpner avviket igjen", () => {
    for (const [o, rm] of [[{ price_reference_id: "ny" }, "rm"], [{ price_per_base_unit: 40 }, "rm"], [{}, "annen"]] as const) {
      const t = target(o);
      reconcileAcceptance(line, t, rm);
      expect(t.review_reason).toBe("price_variance");
    }
  });
  it("nye blokkerende årsaker undertrykkes aldri", () => {
    const t = target({ review_reason: "price_variance,unknown_package_size,unsupported_currency" });
    reconcileAcceptance(line, t, "rm");
    expect(t.review_reason).toBe("unknown_package_size,unsupported_currency");
    expect(t.requires_review).toBe(true);
  });
  it("feilkoder fra serveren blir forståelige meldinger", () => {
    expect(acceptPriceErrorMessage("stale_line")).toMatch(/endret/);
    expect(acceptPriceErrorMessage("forbidden")).toMatch(/tilgang/);
    expect(acceptPriceErrorMessage("noe rart")).not.toMatch(/noe rart/);
  });
});

describe("bekreftet leverandørpakning gjenbrukes", () => {
  const ali = { package_size: null, package_unit: null, count_per_package: null, description: "ALI ORIGINAL FINMALT 36X90G" };
  it("bekreftet 36 stk foreslås uten ny inntasting", () => {
    const link = { package_size: 36, package_unit: "stk", base_units_per_package: 36, package_confirmed_at: "2026-09-01" };
    expect(suggestPackage(ali, "stk", link)).toEqual({ size: "36", unit: "stk" });
    expect(packageDisagreement(ali, "stk", link)).toBeNull();
  });
  it("uenighet mellom bekreftet pakning og varenavn vises konkret", () => {
    const link = { package_size: 40, package_unit: "stk", base_units_per_package: 40, package_confirmed_at: "2026-09-01" };
    expect(suggestPackage(ali, "stk", link).size).toBe("40");
    expect(packageDisagreement(ali, "stk", link)).toMatch(/40 stk.*36 stk/);
  });
  it("flere koblinger med ulik pakning velger ikke første rad", () => {
    const rows = [
      { supplier_sku: "A", package_size: 1, package_unit: "kg", base_units_per_package: 1 },
      { supplier_sku: "B", package_size: 25, package_unit: "kg", base_units_per_package: 25 },
    ];
    expect(pickSupplierLink(rows, null)).toBeUndefined();
    expect(pickSupplierLink(rows, "b")?.supplier_sku).toBe("B");
  });
});

describe("Oppdater matching med delvis feil", () => {
  it("viser hvilke som feilet og prøver bare dem igjen", async () => {
    const { InvoiceInbox } = await import("@/fakturaer/components/inbox/InvoiceInbox");
    const mk = (id: string, num: string): InboxInvoice => {
      const assessment = assessInboxInvoice({ ...base, lines: [L({ requires_review: true, review_reason: "unmatched", raw_material_id: null })] });
      return {
        id, invoice_number: num, invoice_date: "2026-09-01", status: "needs_review", legal_entity_id: "le", supplier_id: "s",
        supplier_name: "ASKO", is_credit_note: false, total_amount: 100, total_vat: 0, lines_sum_status: "ok",
        lines_sum_variance_pct: null, source_document_url: null, line_extraction_status: "done", source: "ehf", notes: null,
        paid_at: null, tripletex_is_paid: null, line_extraction_attempts: 0, line_count: 1, assessment, tab: inboxTabOf({ status: "needs_review", assessment }),
      };
    };
    const batch = vi.fn()
      .mockResolvedValueOnce([{ id: "b", label: "ASKO 2" }])
      .mockResolvedValueOnce([]);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <InvoiceInbox
          tab="open" onTabChange={() => {}} invoices={[mk("a", "1"), mk("b", "2")]} isLoading={false} isError={false}
          error={null} onRetry={() => {}} legalEntityId="le" supplierId={null} supplierFilter={null} canWrite canReconcile
          busyId={null} onPrimary={() => {}} onRematch={() => {}} onOpenDetail={() => {}} onFlag={() => {}} onUnflag={() => {}} onBatchMatch={batch}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Viser 2 av 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Oppdater matching/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/ASKO 2/);
    expect(alert.textContent).toMatch(/Ingenting er godkjent/);
    fireEvent.click(screen.getByRole("button", { name: "Prøv igjen" }));
    await waitFor(() => expect(batch).toHaveBeenCalledTimes(2));
    expect((batch.mock.calls[1][0] as InboxInvoice[]).map((i) => i.id)).toEqual(["b"]);
  });
});
