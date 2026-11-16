// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";
import { WORK_ITEM_EFFECT_DEFAULTS } from "@/ravarer/lib/workRpcTypes";
import { decisionsFromWork, sortDecisions } from "@/ravarer/lib/decisions";

const wi = (p: Partial<WorkItem>): WorkItem => ({
  key: "varekort:s1:sku:1", grp: "pris", type: "varekort", kind: "prisavvik", supplier_id: "s1", supplier_name: "TINE", item_key: "sku:1",
  invoice_id: null, invoice_number: null, title: "Smør usaltet 10 kg", sku: "1", rm_id: null, rm_name: "Smør", open_lines: 9, open_invoices: 4,
  invoice_count: 12, amount: 0, impact_nok: null, last_date: "2026-11-10", last_open_line_id: null, reasons: [], first_open_date: "2026-11-03",
  ...WORK_ITEM_EFFECT_DEFAULTS, ...p,
});

let state: { items: WorkItem[]; counts: Record<string, number> } = { items: [], counts: { alle: 0 } };
vi.mock("@/ravarer/hooks/useDecisions", () => ({
  DECISION_LIMIT: 500,
  useDecisions: () => ({
    work: { isLoading: false, isError: false, error: null, refetch: vi.fn() },
    decisions: sortDecisions(decisionsFromWork(state.items)),
    openCount: state.counts.alle, extraCount: 0, truncated: false,
  }),
  useTodayActivity: () => ({ linesSolved: 3, invoicesReleased: 1, isError: false }),
}));
vi.mock("@/ravarer/pages/priskontroll/gjore/VarekortPanel", () => ({ VarekortPanel: () => <div>Svarpanel varekort</div> }));
vi.mock("@/ravarer/pages/priskontroll/gjore/FakturasakPanel", () => ({ FakturasakPanel: () => <div>Svarpanel faktura</div> }));
vi.mock("@/fakturaer/hooks/useSupplierItems", () => ({
  useSupplierItems: () => ({ data: { items: [] } }),
  useSupplierItemLines: () => ({ data: [], isError: false }),
}));

import Beslutninger from "@/ravarer/pages/beslutninger/Beslutninger";

function renderPage(url = "/ravarer/beslutninger") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[url]}><Beslutninger /></MemoryRouter></QueryClientProvider>);
}

describe("Beslutninger-siden", () => {
  beforeEach(() => { window.localStorage.clear(); });
  it("tom kø viser «Alt er besvart»", () => {
    state = { items: [], counts: { alle: 0 } };
    renderPage();
    expect(screen.getAllByText("Alt er besvart").length).toBeGreaterThan(0);
  });
  it("viser antall spørsmål, eldste først, og svarpanelet for valgt spørsmål", () => {
    state = {
      items: [wi({}), wi({ key: "faktura:i1", type: "faktura", grp: "fakturaer", kind: "faktura_mangler_linjer", invoice_id: "i1", invoice_number: "5590213", supplier_name: "Idun", first_open_date: "2026-08-14" })],
      counts: { alle: 2 },
    };
    renderPage("/ravarer/beslutninger?valgt=faktura%3Ai1");
    expect(screen.getByText("Du har 2 spørsmål å svare på")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    const qi = items.findIndex((t) => t.includes("lot seg ikke lese"));
    const pi = items.findIndex((t) => t.includes("Smør har fått ny pris"));
    expect(qi).toBeGreaterThanOrEqual(0);
    expect(qi).toBeLessThan(pi);
    expect(screen.getByText("Svarpanel faktura")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Smør har fått ny pris hos TINE", { selector: "span" }));
    expect(screen.getByText("Svarpanel varekort")).toBeInTheDocument();
    expect(screen.queryByText(/Venter bak/)).toBeNull();
  });
  it("forklaringen kan skjules", () => {
    state = { items: [wi({})], counts: { alle: 1 } };
    renderPage();
    expect(screen.getByText("Bare det systemet ikke vet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skjul forklaring" }));
    expect(screen.queryByText("Bare det systemet ikke vet")).toBeNull();
  });
});
