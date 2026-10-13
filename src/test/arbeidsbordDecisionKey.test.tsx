// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { SupplierItem, SupplierItemLine } from "@/fakturaer/lib/supplierItems";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";

// Syntetiske varekort A og B (ingen nettverk, ingen skriving).
const mk = (s: string, name: string, desc: string, unit: string) => ({
  item: {
    supplier_id: s, item_key: `sku:${s}`, supplier_name: `Leverandør ${s}`, supplier_sku: s, description: desc, status: "mangler_pakning",
    rm_id: `rm-${s}`, linked_rm_id: `rm-${s}`, rm_name: name, rm_sku: null, rm_base_unit: "stk", rm_category: null, rm_cost: null,
    package_size: null, package_unit: null, base_units_per_package: null, package_confirmed_at: null, agreed_price_per_base_unit: null,
    last_open_line_id: `l-${s}`, last_line_id: `l-${s}`, is_primary: true, open_lines: 1,
  } as unknown as SupplierItem,
  lines: [{
    id: `l-${s}`, invoice_id: `i-${s}`, invoice_number: `F-${s}`, invoice_date: "2026-10-01", invoice_status: "open", flagged_at: null, is_credit_note: false,
    reconciled_mode: null, line_number: 1, supplier_sku: s, description: desc, quantity: 2, unit, unit_price: 100, total_amount: 200,
    package_size: null, package_unit: null, count_per_package: null, base_quantity: null, price_per_base_unit: null, expected_price_per_base_unit: null,
    price_variance_pct: null, variance_status: null, price_reference_source: null, raw_material_id: `rm-${s}`, raw_material_name: name, match_confidence: null,
    requires_review: true, review_reason: "unknown_package_size", resolution_note: null, created_at: null, line_kind: null, cost_posted: false, in_price_history: false,
  } as SupplierItemLine],
});
const DATA: Record<string, ReturnType<typeof mk>> = {
  A: mk("A", "Vare Alfa", "Alfa pose 100g", "sekk"),
  B: mk("B", "Vare Beta", "Beta kartong 250g", "krt"),
};

vi.mock("@/hooks/useCompany", () => ({ useCompany: () => ({ data: { id: "c1" } }) }));
vi.mock("@/fakturaer/hooks/useInvoiceRights", () => ({ useInvoiceRights: () => ({ canWrite: true }) }));
vi.mock("@/fakturaer/hooks/useSupplierItems", () => ({
  useSupplierItems: (f: { supplierId: string }) => ({ data: { items: [DATA[f.supplierId].item] }, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useSupplierItemLines: (s: string) => ({ data: DATA[s].lines, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  usePackageInference: () => ({ data: undefined, isFetching: false }),
  useLinkSupplierItem: () => ({ mutateAsync: vi.fn(() => { throw new Error("skriving er ikke tillatt i test"); }), isPending: false }),
}));
vi.mock("@/fakturaer/hooks/useMaterialChoices", () => ({
  useMaterialChoices: () => ({ suggestions: { data: [] }, results: { data: [] } }),
  useMaterialById: (id: string | null) => ({ data: id ? { id, name: id, base_unit: "stk" } : undefined, isLoading: false }),
}));
vi.mock("@/fakturaer/components/supplier-item/SupplierItemHistory", () => ({ SupplierItemHistory: () => null }));
vi.mock("@/fakturaer/components/decisions/AuditHistory", () => ({ AuditHistory: () => null }));
vi.mock("@/ravarer/pages/priskontroll/gjore/SupplierLinkAliases", () => ({ SupplierLinkAliases: () => null }));

const work = (s: string) => ({ type: "varekort", supplier_id: s, item_key: `sku:${s}`, invoice_id: null, kind: "pakning" }) as unknown as WorkItem;
const ctx = { onDone: vi.fn(), onNext: vi.fn(), onSkip: vi.fn() };
const wrap = (n: ReactNode) => <QueryClientProvider client={new QueryClient()}><MemoryRouter>{n}</MemoryRouter></QueryClientProvider>;
const pkgInput = () => screen.getAllByRole("textbox").find((i) => (i as HTMLInputElement).id.includes("si-sku:")) as HTMLInputElement | undefined;

describe("arbeidsbordets beslutningspanel nullstilles per kort", async () => {
  const { renderWorkDecision, decisionKey } = await import("@/ravarer/pages/priskontroll/arbeidsbord/Arbeidsbord");

  it("nøkkelen er stabil per kort og skiller varekort/faktura", () => {
    expect(decisionKey(work("A"))).toBe(decisionKey(work("A")));
    expect(decisionKey(work("A"))).not.toBe(decisionKey(work("B")));
    expect(decisionKey({ type: "faktura", supplier_id: null, item_key: null, invoice_id: "i1", kind: null } as unknown as WorkItem)).toBe("fa|i1|");
  });

  it("A → neste B → tilbake A viser riktig kort, innsikt og utkast", () => {
    const { rerender } = render(wrap(renderWorkDecision(work("A"), ctx, null, vi.fn())));
    expect(screen.getAllByText(/Vare Alfa/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Fakturert per sekk/)).toBeTruthy();
    const a = pkgInput();
    if (a) fireEvent.change(a, { target: { value: "12" } });

    // Samme kort, annet original-linjevalg: utkastet beholdes.
    rerender(wrap(renderWorkDecision(work("A"), ctx, "l-A", vi.fn())));
    if (a) expect(pkgInput()?.value).toBe("12");

    rerender(wrap(renderWorkDecision(work("B"), ctx, null, vi.fn())));
    expect(screen.queryByText(/Vare Alfa/)).toBeNull();
    expect(screen.getAllByText(/Vare Beta/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Fakturert per krt/)).toBeTruthy();
    expect(screen.queryByText(/Fakturert per sekk/)).toBeNull();
    if (a) expect(pkgInput()?.value ?? "").not.toBe("12");

    rerender(wrap(renderWorkDecision(work("A"), ctx, null, vi.fn())));
    expect(screen.getAllByText(/Vare Alfa/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Vare Beta/)).toBeNull();
    if (a) expect(pkgInput()?.value ?? "").not.toBe("12");
  });
});
