// @vitest-environment jsdom
/** Fase 5B-reparasjon: faktiske parsere/hooks/komponenter med mocket I/O. Ingen ekte skriving. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpcCalls: unknown[] = [];
const sheetStatus = vi.hoisted(() => ({ value: { kind: "absent" } as { kind: string; status?: string } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async (fn: string, args: unknown) => { rpcCalls.push({ fn, args }); return { data: null, error: { code: "23505", message: "dup" } }; } },
}));
vi.mock("@/ravarer/lib/countSheets", () => ({ fetchCountSheetStatus: async () => sheetStatus.value }));
vi.mock("@/ravarer/hooks/useResaleStock", () => ({
  useReorderSuggestions: () => ({ data: undefined, isLoading: false, isError: true, error: new Error("x"), refetch: () => undefined }),
  reorderGroupToCsv: () => "", reorderGroupToText: () => "",
}));

import { parseCountResult, CountOutcomeUnknownError } from "@/ravarer/lib/countSubmission";
import { parseReceiveResult, ReceiveOutcomeUnknownError } from "@/ravarer/lib/receiptStatus";
import { fetchAllRowsExact, IncompleteFetchError } from "@/lib/countedPaging";
import { useCountSubmission } from "@/ravarer/pages/varetelling/useCountSubmission";
import { ReorderSuggestions } from "@/ravarer/components/stock/ReorderSuggestions";
import { DraftSaveStatus } from "@/ravarer/pages/varetelling/CountPanels";

const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { rpcCalls.length = 0; localStorage.clear(); sheetStatus.value = { kind: "absent" }; });

describe("tellesvar", () => {
  const sent = { opId: "op", materialIds: ["a", "b"], countedById: { a: 0, b: 9 } };
  const row = (id: string, before: number, counted: number) => ({ raw_material_id: id, name: id, before, counted, diff: counted - before });
  it("godtar komplett resultat og bar already_applied-reserve", () => {
    expect(parseCountResult({ ok: true, op_id: "op", adjusted: 2, unchanged: 0, rows: [row("a", 4, 0), row("b", 10, 9)] }, sent).detailsUnavailable).toBe(false);
    expect(parseCountResult({ ok: true, already_applied: true }, sent).detailsUnavailable).toBe(true);
  });
  it.each([
    [{ ok: true, op_id: "op", adjusted: -1, unchanged: 3, rows: [row("a", 4, 0), row("b", 10, 9)] }],
    [{ ok: true, op_id: "op", adjusted: 1, unchanged: 1, rows: [row("a", 4, 0), row("a", 4, 0)] }],
    [{ ok: true, op_id: "op", adjusted: 2, unchanged: 0, rows: [{ raw_material_id: "a" }, row("b", 10, 9)] }],
    [{ ok: true, op_id: "op", adjusted: 2, unchanged: 0, rows: [row("a", 4, 1), row("b", 10, 9)] }],
    [{ ok: true, already_applied: true, op_id: "annen" }],
    [{ ok: true, already_applied: true, op_id: "op", rows: [{ raw_material_id: "a" }] }],
  ])("ukjent: %j", (v) => {
    expect(() => parseCountResult(v, sent)).toThrow(CountOutcomeUnknownError);
  });
});

describe("mottakssvar", () => {
  it("gyldige varianter: allerede mottatt uten movement_id, kreditnota negativ med null parti", () => {
    expect(parseReceiveResult({ ok: true, already_received: true, quantity_base: 48, received_at: "2026-10-01T00:00:00Z", lot_id: null }).kind).toBe("already");
    expect(parseReceiveResult({ ok: true, already_received: false, quantity_base: -5, lot_id: null, movement_id: "m" }).kind).toBe("received");
  });
  it.each([
    [{ ok: true, already_received: true, quantity_base: 0, received_at: "x", lot_id: null }],
    [{ ok: true, already_received: true, quantity_base: 1, lot_id: null }],
    [{ ok: true, already_received: false, quantity_base: 1, movement_id: "m" }],
    [{ ok: true, already_received: false, quantity_base: 0, lot_id: null, movement_id: "m" }],
  ])("ukjent: %j", (v) => {
    expect(() => parseReceiveResult(v)).toThrow(ReceiveOutcomeUnknownError);
  });
});

describe("bevist komplett sidehenting", () => {
  const data = Array.from({ length: 201 }, (_, i) => ({ id: `r${String(i).padStart(4, "0")}` }));
  it("tak 200 under sidestørrelse 1000: alle 201", async () => {
    const rows = await fetchAllRowsExact((from) => Promise.resolve({ data: data.slice(from, from + 200), error: null, count: data.length }));
    expect(rows).toHaveLength(201);
  });
  it("manglende antall, tom side og endret antall kaster", async () => {
    await expect(fetchAllRowsExact(() => Promise.resolve({ data: [], error: null, count: null }))).rejects.toBeInstanceOf(IncompleteFetchError);
    await expect(fetchAllRowsExact((from) => Promise.resolve({ data: from === 0 ? data.slice(0, 200) : [], error: null, count: 201 }))).rejects.toMatchObject({ reason: "early_end" });
    let n = 0;
    await expect(fetchAllRowsExact((from) => Promise.resolve({ data: data.slice(from, from + 200), error: null, count: n++ === 0 ? 201 : 202 }))).rejects.toMatchObject({ reason: "changed" });
  });
});

describe("telleinnsending", () => {
  const sub = { legalEntityId: "A", opId: "op1", note: "n", sentAt: "2026-10-11T00:00:00Z", lines: [{ raw_material_id: "a", counted_base: 1, expected_base: 2, line_note: null, location: null }] };
  it("uten skrivetilgang sendes ingenting", async () => {
    const { result } = renderHook(() => useCountSubmission("A", false), { wrapper: wrap });
    await act(async () => { await result.current.send(sub); });
    expect(rpcCalls).toHaveLength(0);
  });
  it("innsending fra selskap A sendes aldri i selskap B", async () => {
    const { result } = renderHook(() => useCountSubmission("B", true), { wrapper: wrap });
    await act(async () => { await result.current.send(sub); });
    expect(rpcCalls).toHaveLength(0);
  });
  it("23505 frigjøres ikke før den opprinnelige operasjonen er avstemt; lesefeil holder låst", async () => {
    const { result } = renderHook(() => useCountSubmission("A", true), { wrapper: wrap });
    await act(async () => { await result.current.send(sub); });
    expect(result.current.state.kind).toBe("rejected");
    let released = true;
    act(() => { released = result.current.release(); });
    expect(released).toBe(false);
    sheetStatus.value = { kind: "error" };
    await act(async () => { await result.current.reconcile(); });
    act(() => { released = result.current.release(); });
    expect(released).toBe(false);
    sheetStatus.value = { kind: "found", status: "applied" };
    await act(async () => { await result.current.reconcile(); });
    expect(result.current.state).toMatchObject({ reconciliation: "applied" });
    act(() => { released = result.current.release(); });
    expect(released).toBe(true);
  });
});

describe("tilstander", () => {
  it("Bestilling som egen fane viser feil, ikke tom side", () => {
    render(<ReorderSuggestions standalone />, { wrapper: wrap });
    expect(screen.getByRole("button", { name: /prøv igjen/i })).toBeTruthy();
  });
  it("lokal lagringsfeil vises, ikke «lagret på denne enheten»", () => {
    render(<DraftSaveStatus hasDraft server="idle" localFailed />);
    expect(screen.getByRole("alert").textContent).toMatch(/kunne ikke lagres på denne enheten/);
  });
});
