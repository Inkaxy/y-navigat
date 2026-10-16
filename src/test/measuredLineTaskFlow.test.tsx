// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

/** Mockdata — ingen ekte forretningsdata lagres. */
const RM_KG = { id: "rm-kaffe", name: "Kaffe, malt", sku: "R-1042", category: null, current_cost_price: null, base_unit: "kg", primary_supplier_id: null, item_type: null };
let RM = RM_KG;
/** Når satt, svarer råvareoppslaget aldri (lastetilstand). */
let rmPending = false;

function chain(table: string) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "or", "limit", "order", "not", "range"]) c[m] = () => c;
  c.single = () => (rmPending ? new Promise(() => {}) : Promise.resolve({ data: table === "raw_materials" ? RM : null, error: null }));
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
  return c;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => chain(t),
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  },
}));

const acceptMatch = vi.fn();
const recalculateLines = vi.fn();
vi.mock("@/fakturaer/lib/acceptMatch", () => ({
  acceptMatch: (...a: unknown[]) => acceptMatch(...a),
  recalculateLines: (...a: unknown[]) => recalculateLines(...a),
  startPriceOutcomeLabel: () => null,
}));

import { LineTask } from "@/fakturaer/components/inbox/task/LineTask";
import { lineStatus } from "@/fakturaer/lib/lineStatus";

function makeLine(over: Partial<ReviewLineRow> = {}): ReviewLineRow {
  return {
    id: "line-a",
    invoice_id: "inv-1",
    line_number: 1,
    supplier_sku: "110482",
    description: "ALI ORIGINAL FINMALT 36X90G",
    quantity: 2,
    unit: "kartong",
    unit_price: 730.8,
    total_amount: 1461.6,
    package_size: null,
    package_unit: null,
    count_per_package: null,
    base_quantity: null,
    match_confidence: "auto_high",
    raw_material_id: RM.id,
    price_per_base_unit: null,
    expected_price_per_base_unit: null,
    price_variance_pct: null,
    variance_status: null,
    review_reason: "unknown_package_size",
    requires_review: true,
    price_reference_source: null,
    price_reference_id: null,
    price_reference_date: null,
    invoice: {
      id: "inv-1",
      invoice_number: "330702353",
      invoice_date: "2026-09-30",
      legal_entity_id: "le",
      supplier_id: "sup",
      status: "needs_review",
      source: "tripletex",
      currency: "NOK",
      is_credit_note: false,
      source_document_url: null,
      total_amount: null,
      total_vat: null,
      lines_sum_status: null,
      lines_sum_excl_vat: null,
      lines_sum_variance_pct: null,
      extraction_confidence: null,
      supplier: { name: "ASKO", contact_email: null },
      legal_entity: null,
    },
    suggestions: [],
    matched_raw_material: { name: RM.name, sku: RM.sku, category: null, base_unit: "kg" },
    ...over,
  };
}

function setup(line: ReviewLineRow, onSaved = vi.fn(async () => {}), onCorrectLine = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
  const props = {
    status: lineStatus(line),
    link: null,
    tolerancePct: 5,
    position: { index: 0, total: 2 },
    canWrite: true,
    reconcileReady: false,
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onSaved,
    onSecondary: vi.fn(),
    onShowDocument: vi.fn(),
    onReconcile: vi.fn(),
    onCorrectLine,
  };
  const utils = render(wrap(<LineTask key={line.id} line={line} {...props} />));
  const rerenderWith = (l: ReviewLineRow) =>
    utils.rerender(wrap(<LineTask key={l.id} line={l} {...props} status={lineStatus(l)} />));
  return { ...utils, onSaved, onCorrectLine, rerenderWith };
}

const okResult = { lineIds: ["line-a"], rmsId: "rms", startPrice: { attempted: false, created: false, reason: null, price: null, currency: null, baseUnit: null, effectiveDate: null }, recalculationPending: false, recalculationError: null };

beforeEach(() => {
  cleanup();
  acceptMatch.mockReset();
  RM = RM_KG;
  rmPending = false;
  recalculateLines.mockReset();
});


describe("Målt mengde i pakningsmodus — ingen blindvei", () => {
  it("kg-linje med pakningsstatus og ugyldig skjult pakning lagrer uten pakning", async () => {
    acceptMatch.mockResolvedValue(okResult);
    const { onSaved } = setup(makeLine({ unit: "kg", quantity: 23840, unit_price: 5.84, total_amount: 139225.6, package_size: -3, package_unit: "sekk" }));
    expect(await screen.findByText(/Målt mengde/)).toBeTruthy();
    expect(screen.queryByText(/Hvor mye inneholder/)).toBeNull();
    expect(screen.queryByText(/pakningen må bekreftes/)).toBeNull();
    expect(screen.queryByText(/pakningen som bekreftet/)).toBeNull();
    expect(screen.getAllByText(/ingen pakning lagres eller bekreftes/).length).toBeGreaterThan(0);
    const btn = await screen.findByRole("button", { name: /registrert målt mengde og fortsett/ });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("line-a"));
    const arg = acceptMatch.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.confirmPackage).toBe(false);
    expect(arg.packageSize).toBeNull();
    expect(arg.packageUnit).toBeNull();
    expect(arg.baseUnitsPerPackage).toBeNull();
  });

  it("kreditlinje i kg viser kreditforklaring og retting, aldri kost-/pakningsgodkjenning", async () => {
    const { onCorrectLine } = setup(makeLine({ unit: "kg", quantity: -3000, unit_price: 5.84, total_amount: -17520 }));
    expect((await screen.findAllByText(/Kreditlinje/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/mangler mengde/)).toBeNull();
    expect(screen.queryByText(/pakningen må bekreftes/)).toBeNull();
    expect(screen.queryByText(/Dette lagres/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Bekreft pakning og fortsett" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Rett fakturalinje" })[0]);
    expect(onCorrectLine).toHaveBeenCalled();
    expect(acceptMatch).not.toHaveBeenCalled();
  });

  it("bulk uten vekt åpner full linjeretting for levert kg", async () => {
    const { onCorrectLine } = setup(makeLine({ unit: "bulk", quantity: 1, unit_price: 139225.6, total_amount: 139225.6 }));
    fireEvent.click(await screen.findByRole("button", { name: /Rett fakturalinje \(oppgi levert kg\)/ }));
    expect(onCorrectLine).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Rett bare fakturert enhet" })).toBeTruthy();
    expect(acceptMatch).not.toHaveBeenCalled();
    expect(screen.queryByText(/Dette lagres/)).toBeNull();
  });

  it("vanlig kartong uendret: spør innhold og bekrefter pakning", async () => {
    acceptMatch.mockResolvedValue(okResult);
    setup(makeLine());
    expect(await screen.findByText(/Hvor mye inneholder én kartong/)).toBeTruthy();
    expect(screen.getByText(/pakningen må bekreftes/)).toBeTruthy();
    expect(screen.getByText(/pakningen som bekreftet/)).toBeTruthy();
    const btn = await screen.findByRole("button", { name: "Bekreft pakning og fortsett" });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(acceptMatch).toHaveBeenCalled());
    expect((acceptMatch.mock.calls[0][0] as Record<string, unknown>).confirmPackage).toBe(true);
  });
});
