// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let detail: unknown = null;
let canWrite = true;
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: async () => ({ data: [], error: null }) } }));
vi.mock("@/ravarer/pages/priskontroll/saker/useSupplierCaseDetail", () => ({ useSupplierCaseDetail: () => ({ data: detail, isLoading: false, isError: false, error: null, refetch: () => undefined }) }));
vi.mock("@/ravarer/hooks/useUserNames", () => ({ useUserNames: () => ({ data: new Map() }) }));
vi.mock("@/fakturaer/hooks/useInvoiceRights", () => ({ useInvoiceRights: () => ({ canWrite }) }));
vi.mock("@/fakturaer/components/decisions/AuditHistory", () => ({ AuditHistory: () => <p>historikk</p> }));

import { SupplierCaseDetail } from "@/ravarer/pages/priskontroll/saker/SupplierCaseDetail";

const line = (kind: string | null, amount: number, observed: number | null) => ({
  id: `cl-${kind}`, invoice_id: "i1", invoice_line_id: "l1", amount_excl_vat: amount,
  basis: { case_kind: kind, price_reference_source: "last_purchase", price_reference_date: "2026-09-01", observed_effect_excl_vat: observed, price_per_base_unit: 28.81, expected_price_per_base_unit: 14, base_quantity: 600, base_unit: "kg" },
  invoice: { invoice_number: "666738", invoice_date: "2026-09-21" }, line: { description: "MELIS 25 KG", supplier_sku: "1", quantity: 24, unit: "sekk", unit_price: 1, raw_material: { name: "Melis", base_unit: "kg" } },
});
const data = (lines: ReturnType<typeof line>[], credits: unknown[] = []) => ({
  c: { id: "c1", legal_entity_id: "e", supplier_id: "s", title: "Sak", reason: null, status: "open", follow_up_on: null, resolution_note: null, responsible_user_id: null, created_at: "2026-10-11T10:00:00Z", supplier: { name: "Lev" } },
  lines, credits, notes: [], unallocated: () => 0, remaining: new Map([["i1", 0]]),
});
const show = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><SupplierCaseDetail id="c1" /></MemoryRouter></QueryClientProvider>);

describe.each([[390], [1440]])("saksdetalj ved %ipx", (w) => {
  it("prisforespørsel: ingen kravsaldo eller kreditfordeling, observert forskjell merket", () => {
    window.innerWidth = w;
    detail = data([line("price_inquiry", 0, 8886)]);
    show();
    expect(screen.getByText("Prisforespørsel — ingen penger kreves")).toBeInTheDocument();
    expect(screen.getByText(/ikke skyldig beløp/)).toBeInTheDocument();
    for (const t of [/^Kreditert$/, /^Gjenstår$/, /Restavvik/, /Fordel kreditnota/]) expect(screen.queryByText(t)).toBeNull();
    expect(screen.getAllByText(/tidligere kjøp/).length).toBeGreaterThan(0);
  });
  it("dokumentert krav: saldo vises", () => {
    detail = data([line("documented_claim", 500, 500)]);
    show();
    expect(screen.getByText("Dokumentert krav (avtalepris)")).toBeInTheDocument();
    expect(screen.getByText("Gjenstår")).toBeInTheDocument();
  });
  it("eldre sak: gjennomgang, ingen beløpspåstand, ingen «ny sak fra varekortet»", () => {
    detail = data([line(null, 300, null)]);
    show();
    expect(screen.getByText(/må gjennomgås/)).toBeInTheDocument();
    expect(screen.queryByText("Gjenstår")).toBeNull();
    expect(screen.queryByText(/Opprett en ny sak fra varekortet/)).toBeNull();
  });
});

describe("historikk bevares og rettigheter følges", () => {
  it("prisforespørsel med lagret fordeling viser den som historikk", () => {
    detail = data([line("price_inquiry", 0, 8886)], [{ id: "cr", invoice_id: "i1", credit_invoice_id: "k", amount_excl_vat: 10, note: null, created_at: "2026-10-01", credit: { invoice_number: "K1" } }]);
    show();
    expect(screen.getByText("Registrert kreditfordeling (historikk)")).toBeInTheDocument();
  });
  it("lesetilgang: ingen statusknapper", () => {
    canWrite = false;
    detail = data([line("documented_claim", 500, 500)]);
    show();
    expect(screen.queryByRole("button", { name: "Avbryt saken" })).toBeNull();
    canWrite = true;
  });
});
