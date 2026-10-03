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

function setup(line: ReviewLineRow, onSaved = vi.fn(async () => {})) {
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
  };
  const utils = render(wrap(<LineTask key={line.id} line={line} {...props} />));
  const rerenderWith = (l: ReviewLineRow) =>
    utils.rerender(wrap(<LineTask key={l.id} line={l} {...props} status={lineStatus(l)} />));
  return { ...utils, onSaved, rerenderWith };
}

const okResult = { lineIds: ["line-a"], rmsId: "rms", startPrice: { attempted: false, created: false, reason: null, price: null, currency: null, baseUnit: null, effectiveDate: null }, recalculationPending: false, recalculationError: null };

beforeEach(() => {
  cleanup();
  acceptMatch.mockReset();
  RM = RM_KG;
  rmPending = false;
  recalculateLines.mockReset();
});

describe("Kontrollflaten — pakning direkte i oppgaven", () => {
  it("allerede koblet råvare går rett til pakningsskjema uten nytt søk", async () => {
    setup(makeLine());
    expect(await screen.findByText(/Hvor mye inneholder én kartong/)).toBeTruthy();
    expect(screen.queryByLabelText("Søk i råvareregisteret")).toBeNull();
    expect(screen.getByText(/Råvare:/)).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/6,48 kg/).length).toBeGreaterThan(0));
  });

  it("lagrer gjennom acceptMatch med den koblede råvaren og bekreftet pakning", async () => {
    acceptMatch.mockResolvedValue(okResult);
    const { onSaved } = setup(makeLine());
    const btn = await screen.findByRole("button", { name: "Bekreft pakning og fortsett" });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("line-a"));
    const opts = acceptMatch.mock.calls[0][0] as { rawMaterialId: string; confirmPackage: boolean; packageUnit: string };
    expect(opts.rawMaterialId).toBe(RM.id);
    expect(opts.confirmPackage).toBe(true);
  });

  it("lagringsfeil vises i oppgaven, og inntastingen beholdes", async () => {
    acceptMatch.mockRejectedValue(new Error("db feil med constraint_navn"));
    const { onSaved } = setup(makeLine());
    const input = await screen.findByLabelText(/Innhold per/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "3 240" } });
    const btn = await screen.findByRole("button", { name: "Bekreft pakning og fortsett" });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Inntastingen er beholdt");
    expect(alert.textContent).not.toContain("constraint");
    expect((screen.getByLabelText(/Innhold per/) as HTMLInputElement).value).toBe("3 240");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("feilet reberegning holder linjen åpen og tilbyr å prøve igjen", async () => {
    acceptMatch.mockResolvedValue({ ...okResult, recalculationPending: true, recalculationError: "tidsavbrudd" });
    const { onSaved } = setup(makeLine());
    const btn = await screen.findByRole("button", { name: "Bekreft pakning og fortsett" });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("ikke regnet om");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Prøv igjen" })).toBeTruthy();
  });

  it("bytte av linje tar ikke med utkastet", async () => {
    const { rerenderWith } = setup(makeLine());
    fireEvent.change(await screen.findByLabelText(/Innhold per/), { target: { value: "999" } });
    rerenderWith(makeLine({ id: "line-b", description: "HVETEMEL SIKTET 25 KG", unit: "sekk" }));
    await waitFor(() => expect((screen.getByLabelText(/Innhold per/) as HTMLInputElement).value).toBe("25"));
  });

  it("umatchet linje viser råvarevalg, og knappen er sperret til en råvare er valgt", () => {
    setup(makeLine({ raw_material_id: null, match_confidence: "unmatched", review_reason: "unmatched", matched_raw_material: null }));
    expect(screen.getByLabelText("Søk i råvareregisteret")).toBeTruthy();
    const btn = screen.getByRole("button", { name: "Bekreft råvare og fortsett" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText("Velg en råvare først.")).toBeTruthy();
  });
});

const ALI_STK = { ...RM_KG, base_unit: "stk" };
const aliStkLine = () => makeLine({ matched_raw_material: { name: RM_KG.name, sku: RM_KG.sku, category: null, base_unit: "stk" } });
type Payload = { packageSize: number | null; packageUnit: string | null; baseUnitsPerPackage: number | null; confirmPackage: boolean };

describe("Pakning for stk-råvare (ALI 36×90 g)", () => {
  it("foreslår 36 stk per kartong — 90 g er vekt per stk, ikke antall", async () => {
    RM = ALI_STK;
    setup(aliStkLine());
    const input = (await screen.findByLabelText(/Antall stk per kartong/)) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("36"));
    expect(screen.getByText(/90 g er vekt eller volum per stk/)).toBeTruthy();
    expect(screen.getByText(/2 kartong × 36 stk =/)).toBeTruthy();
    expect(screen.queryByLabelText("Enhet")).toBeNull();
  });

  it("endret antall er nøyaktig det som lagres", async () => {
    RM = ALI_STK;
    acceptMatch.mockResolvedValue(okResult);
    setup(aliStkLine());
    const input = await screen.findByLabelText(/Antall stk per kartong/);
    await waitFor(() => expect((input as HTMLInputElement).value).toBe("36"));
    fireEvent.change(input, { target: { value: "40" } });
    expect(await screen.findByText(/2 kartong × 40 stk =/)).toBeTruthy();
    const btn = screen.getByRole("button", { name: "Bekreft pakning og fortsett" }) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(acceptMatch).toHaveBeenCalled());
    const opts = acceptMatch.mock.calls[0][0] as Payload;
    expect(opts).toMatchObject({ packageSize: 40, packageUnit: "stk", baseUnitsPerPackage: 40, confirmPackage: true });
  });

  it.each(["", "0", "-1", "abc"])("ugyldig utkast «%s» sperrer bekreftelse", async (v) => {
    RM = ALI_STK;
    setup(aliStkLine());
    const input = await screen.findByLabelText(/Antall stk per kartong/);
    await waitFor(() => expect((input as HTMLInputElement).value).toBe("36"));
    fireEvent.change(input, { target: { value: v } });
    const btn = screen.getByRole("button", { name: "Bekreft pakning og fortsett" }) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(true));
    expect(screen.queryByText(/2 kartong × /)).toBeNull();
    expect(acceptMatch).not.toHaveBeenCalled();
  });

  it("pakningsutkast lekker ikke til neste linje", async () => {
    RM = ALI_STK;
    const { rerenderWith } = setup(aliStkLine());
    const input = await screen.findByLabelText(/Antall stk per kartong/);
    await waitFor(() => expect((input as HTMLInputElement).value).toBe("36"));
    fireEvent.change(input, { target: { value: "99" } });
    rerenderWith(makeLine({ id: "line-b", description: "TE 20X2G", matched_raw_material: { name: "Te", sku: null, category: null, base_unit: "stk" } }));
    await waitFor(() => expect((screen.getByLabelText(/Antall stk per kartong/) as HTMLInputElement).value).toBe("20"));
  });

  it("mens råvaren lastes vises lastetilstand og bekreftelse er sperret — ikke nytt råvarevalg", () => {
    rmPending = true;
    setup(aliStkLine());
    expect(screen.getAllByText(/Henter råvaren/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Velg råvare/)).toBeNull();
    expect(screen.queryByLabelText("Søk i råvareregisteret")).toBeNull();
    const btn = screen.getByRole("button", { name: "Bekreft pakning og fortsett" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
