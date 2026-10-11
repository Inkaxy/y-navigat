// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const RPC = vi.fn();
const FROM = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => RPC(...a), from: (...a: unknown[]) => FROM(...a), functions: { invoke: vi.fn() } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/ravarer/lib/invalidate", () => ({ invalidateRawMaterial: vi.fn() }));
vi.mock("@/ravarer/context/RavarerContext", () => ({ useRavarer: () => ({ canWrite: true, legalEntityId: "le", user: { id: "u" } }) }));
vi.mock("@/ravarer/editors/PackageEditor", () => ({ PackageEditor: () => null }));
vi.mock("@/ravarer/pages/varemottak/ReceiptDeviation", () => ({ DeviationDialog: () => null, receiptLineAsWorklistRow: () => null }));

const LINES = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock("@/ravarer/hooks/useGoodsReceipt", async orig => {
  const real = await orig<typeof import("@/ravarer/hooks/useGoodsReceipt")>();
  return { ...real, useReceiptLines: () => ({ data: LINES.value, isLoading: false, isError: false, error: null, refetch: vi.fn() }) };
});

import { parseReceiveResult, receiptState, ReceiveOutcomeUnknownError, validateBestBefore, type ReceiptLineFacts } from "@/ravarer/lib/receiptStatus";
import { useReceiveInvoiceLine } from "@/ravarer/hooks/useGoodsReceipt";
import { InvoiceReceiptPanel } from "@/ravarer/pages/varemottak/InvoiceReceiptPanel";

const wrap = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter><QueryClientProvider client={qc}>{children}</QueryClientProvider></MemoryRouter>
  );
};

const coca = (over: Partial<ReceiptLineFacts> = {}): ReceiptLineFacts => ({
  raw_material_id: "rm", stock_tracking: true, quantity: 48, unit: "stk", base_quantity: null, base_unit: "stk",
  requires_review: false, not_applicable: false, is_credit_note: false,
  receipt: { status: "ok", value: null }, movement: { status: "ok", value: { quantity_base: 48, types: ["purchase"] } },
  ...over,
});

beforeEach(() => { RPC.mockReset(); FROM.mockReset(); });

describe("mottaksstatus skiller bevegelse fra bekreftet mottak", () => {
  it("COCA-COLA 48 stk, purchase uten mottak, null base_quantity: kan bekreftes", () => {
    expect(receiptState(coca())).toEqual({ kind: "receivable", quantity: 48, credit: false, hasMovement: true });
  });
  it("bekreftet innkjøp og bekreftet kreditretur", () => {
    expect(receiptState(coca({ receipt: { status: "ok", value: { quantity_base: 48, received_at: "2026-10-01", lot_id: "l" } } })).kind).toBe("confirmed");
    const cr = receiptState(coca({ is_credit_note: true, receipt: { status: "ok", value: { quantity_base: -5, received_at: "2026-10-01", lot_id: null } } }));
    expect(cr).toMatchObject({ kind: "confirmed", credit: true });
  });
  it("kreditnota uten mottak beholder negativ mengde", () => {
    expect(receiptState(coca({ is_credit_note: true, receipt: { status: "ok", value: null } }))).toMatchObject({ kind: "receivable", quantity: -48, credit: true });
  });
  it("ikke lagerført, venter kontroll, ukjent og manglende omregning", () => {
    expect(receiptState(coca({ stock_tracking: false })).kind).toBe("untracked");
    expect(receiptState(coca({ requires_review: true })).kind).toBe("review");
    expect(receiptState(coca({ receipt: { status: "error" } })).kind).toBe("unknown");
    expect(receiptState(coca({ unit: "kasse" })).kind).toBe("needs_quantity");
    expect(receiptState(coca({ movement: { status: "error" } }))).toMatchObject({ kind: "receivable", hasMovement: null });
  });
  it("best før valideres", () => {
    expect(validateBestBefore("2026-02-30").ok).toBe(false);
    expect(validateBestBefore("12.10.2026").ok).toBe(false);
    expect(validateBestBefore("")).toEqual({ ok: true, value: null });
  });
});

describe("RPC-svar", () => {
  it("tre kjente varianter", () => {
    expect(parseReceiveResult({ ok: true, skipped: "ikke_lagerfort" })).toEqual({ kind: "not_stock" });
    expect(parseReceiveResult({ ok: true, already_received: true, quantity_base: 48, received_at: "t", lot_id: null }).kind).toBe("already");
    expect(parseReceiveResult({ ok: true, already_received: false, quantity_base: -5, lot_id: null, movement_id: "m" }).kind).toBe("received");
  });
  it("generisk skipped er ikke «allerede mottatt»; uventet = ukjent", () => {
    for (const bad of [{ ok: true, skipped: "noe" }, { ok: true }, null, { ok: true, already_received: false, quantity_base: 1 }]) {
      expect(() => parseReceiveResult(bad)).toThrow(ReceiveOutcomeUnknownError);
    }
  });
});

describe("useReceiveInvoiceLine", () => {
  it("kaller bare RPC-en, aldri en ekstra lagerbevegelse", async () => {
    RPC.mockResolvedValueOnce({ data: { ok: true, already_received: false, quantity_base: 48, lot_id: "l", movement_id: "m" }, error: null });
    const h = renderHook(() => useReceiveInvoiceLine(), { wrapper: wrap() });
    await act(async () => {
      await h.result.current.mutateAsync({ invoice_line_id: "line", invoice_id: "inv", raw_material_id: "rm", invoice_number: "9205352553", lot_number: "L1", best_before: "2027-01-01" });
    });
    expect(RPC).toHaveBeenCalledWith("rm_receive_invoice_line", { p_line_id: "line", p_lot_number: "L1", p_best_before: "2027-01-01", p_note: "Mottak faktura 9205352553" });
    expect(FROM).not.toHaveBeenCalled();
  });
  it("transportfeil er ukjent utfall", async () => {
    RPC.mockRejectedValueOnce(new Error("net"));
    const h = renderHook(() => useReceiveInvoiceLine(), { wrapper: wrap() });
    await expect(act(() => h.result.current.mutateAsync({ invoice_line_id: "l", invoice_id: "i", raw_material_id: "r", invoice_number: "1" }))).rejects.toBeInstanceOf(ReceiveOutcomeUnknownError);
  });
});

describe("InvoiceReceiptPanel (produksjonskomponent)", () => {
  it("purchase uten mottak viser Bekreft mottak; dobbelttrykk sender én gang med frosset parti/dato", async () => {
    LINES.value = [{ ...coca(), id: "line-1", line_number: 1, description: "COCA-COLA 330ML", total_amount: 100, raw_material_name: "Coca-Cola 330 ml" }];
    let resolve: (v: unknown) => void = () => undefined;
    RPC.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    render(<InvoiceReceiptPanel invoiceId="inv" invoiceNumber="9205352553" onClose={() => undefined} canWrite />, { wrapper: wrap() });
    expect(screen.getByText("Ikke bekreftet mottatt")).toBeTruthy();
    expect(screen.getByText("Innkjøp ført på lager")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Partinummer (valgfritt)"), { target: { value: "P-77" } });
    fireEvent.change(screen.getByLabelText("Best før (valgfritt)"), { target: { value: "2027-03-01" } });
    const btn = screen.getByRole("button", { name: /Bekreft mottak/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await act(async () => { resolve({ data: { ok: true, already_received: false, quantity_base: 48, lot_id: "l", movement_id: "m" }, error: null }); });
    expect(RPC).toHaveBeenCalledTimes(1);
    expect(RPC.mock.calls[0][1]).toMatchObject({ p_line_id: "line-1", p_lot_number: "P-77", p_best_before: "2027-03-01" });
    expect(FROM).not.toHaveBeenCalled();
  });
  it("ugyldig dato blokkerer innsending", () => {
    LINES.value = [{ ...coca(), id: "line-1", line_number: 1, description: "X", total_amount: 1, raw_material_name: "X" }];
    render(<InvoiceReceiptPanel invoiceId="inv" invoiceNumber="1" onClose={() => undefined} canWrite />, { wrapper: wrap() });
    fireEvent.change(screen.getByLabelText("Partinummer (valgfritt)"), { target: { value: "x".repeat(70) } });
    expect((screen.getByRole("button", { name: /Bekreft mottak/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
