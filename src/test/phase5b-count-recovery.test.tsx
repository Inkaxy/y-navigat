// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const RPC = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => RPC(...a) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/ravarer/lib/invalidate", () => ({ invalidateRawMaterial: vi.fn() }));

import { countDraftKey, loadCountDraft, missingBaseline, saveCountDraft } from "@/ravarer/lib/countDraft";
import {
  classifyCountError,
  CountOutcomeUnknownError,
  CountRejectedError,
  loadPendingSubmission,
  parseCountResult,
  type PendingCountSubmission,
} from "@/ravarer/lib/countSubmission";
import { useCountSubmission } from "@/ravarer/pages/varetelling/useCountSubmission";
import { buildCountPayload } from "@/ravarer/hooks/useStockCount";

const LE = "le-1";
const wrap = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};
const sub = (opId = "op-1"): PendingCountSubmission => ({
  legalEntityId: LE,
  opId,
  note: "Varetelling",
  sentAt: "2026-10-11T10:00:00Z",
  lines: buildCountPayload([
    { raw_material_id: "b", counted_base: 9, expected_base: 10, line_note: null, location: "Hylle 2" },
    { raw_material_id: "a", counted_base: 0, expected_base: 4 },
  ]),
});
const okResult = (opId = "op-1") => ({
  ok: true, adjusted: 2, unchanged: 0, op_id: opId,
  rows: [{ raw_material_id: "b", name: "B", before: 10, counted: 9, diff: -1 }, { raw_material_id: "a", name: "A", before: 4, counted: 0, diff: -4 }],
});

beforeEach(() => {
  localStorage.clear();
  RPC.mockReset();
});

describe("lokalt utkast beholder opprinnelig forventet beholdning", () => {
  it("talt ved 10, beholdning blir 12: gjenopptatt utkast måler fortsatt mot 10", () => {
    const key = countDraftKey(LE, "2026-10-11");
    saveCountDraft(key, { opId: "op-1", entries: { rm1: [{ amount: "9", unitKey: "__base" }] }, lineNotes: {}, note: "", expected: { rm1: 10 } });
    const live = { rm1: 12 };
    const loaded = loadCountDraft(key);
    expect(loaded?.expected.rm1).toBe(10);
    expect(loaded?.expected.rm1).not.toBe(live.rm1);
    expect(missingBaseline(loaded!)).toEqual([]);
  });
  it("utkast er per selskap", () => {
    saveCountDraft(countDraftKey(LE, "2026-10-11"), { opId: "x", entries: { rm1: [{ amount: "1", unitKey: "__base" }] }, lineNotes: {}, note: "", expected: { rm1: 1 } });
    expect(loadCountDraft(countDraftKey("le-2", "2026-10-11"))).toBeNull();
  });
  it("eldre utkast uten forventet beholdning krever gjennomgang, ingen stille baseline", () => {
    const key = countDraftKey(LE, "2026-10-11");
    localStorage.setItem(key, JSON.stringify({ opId: "o", entries: { rm1: [{ amount: "3", unitKey: "__base" }] }, lineNotes: {}, note: "", savedAt: "2026-10-11T08:00:00Z" }));
    const d = loadCountDraft(key)!;
    expect(d.legacyBaseline).toBe(true);
    expect(missingBaseline(d)).toEqual(["rm1"]);
  });
});

describe("resultatkontrakt", () => {
  const sent = { opId: "op-1", materialIds: ["b", "a"] };
  it("gyldig svar godtas", () => {
    expect(parseCountResult(okResult(), sent).adjusted).toBe(2);
  });
  it("uventet svar er ukjent utfall, aldri «ingenting er bokført»", () => {
    for (const bad of [null, "x", [], { ok: true }, { ok: true, adjusted: "2", unchanged: 0, rows: [] }, { ...okResult(), op_id: "annen" }]) {
      expect(() => parseCountResult(bad, sent)).toThrow(CountOutcomeUnknownError);
    }
    try { parseCountResult({ ok: true }, sent); } catch (e) { expect((e as Error).message).not.toMatch(/Ingenting er bokført/); }
  });
  it("already_applied med ufullstendig lagret resultat: bokført, detaljer utilgjengelig", () => {
    const r = parseCountResult({ ok: true, already_applied: true }, sent);
    expect(r).toMatchObject({ alreadyApplied: true, detailsUnavailable: true, rows: [] });
  });
  it("feilkoder klassifiseres", () => {
    expect(classifyCountError({ code: "40001", message: "x" })).toMatchObject({ kind: "conflict" });
    expect(classifyCountError({ code: "23505" })).toMatchObject({ kind: "content" });
    expect(classifyCountError({ code: "42501" })).toMatchObject({ kind: "access" });
    expect(classifyCountError({ message: "Failed to fetch" })).toBeInstanceOf(CountOutcomeUnknownError);
  });
});

describe("useCountSubmission: nøyaktig samme innsending ved nytt forsøk", () => {
  it("tapt svar etter commit → låst; reload; nytt forsøk sender identisk opId og ordnede linjer", async () => {
    RPC.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });
    const first = renderHook(() => useCountSubmission(LE), { wrapper: wrap() });
    const s = sub();
    await act(async () => { await first.result.current.send(s); });
    expect(first.result.current.state.kind).toBe("unknown");
    expect(first.result.current.locked).toBe(true);
    expect(first.result.current.release()).toBe(false); // ukjent frigjøres ikke
    const sentFirst = RPC.mock.calls[0][1];
    first.unmount();

    // Reload: ny instans leser lagret innsending
    expect(loadPendingSubmission(LE)?.opId).toBe("op-1");
    RPC.mockResolvedValueOnce({ data: { ...okResult(), already_applied: true }, error: null });
    const second = renderHook(() => useCountSubmission(LE), { wrapper: wrap() });
    expect(second.result.current.state.kind).toBe("unknown");
    let res: unknown;
    await act(async () => { res = await second.result.current.retry(); });
    expect(RPC.mock.calls[1][1]).toEqual(sentFirst);
    expect((RPC.mock.calls[1][1] as { p_lines: Array<{ raw_material_id: string }> }).p_lines.map(l => l.raw_material_id)).toEqual(["b", "a"]);
    expect(res).toMatchObject({ alreadyApplied: true });
    expect(loadPendingSubmission(LE)).toBeNull();
    expect(second.result.current.locked).toBe(false);
  });

  it("dobbelttrykk sender én gang", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    RPC.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const h = renderHook(() => useCountSubmission(LE), { wrapper: wrap() });
    await act(async () => {
      const p1 = h.result.current.send(sub());
      const p2 = h.result.current.send(sub());
      resolve({ data: okResult(), error: null });
      await Promise.all([p1, p2]);
    });
    expect(RPC).toHaveBeenCalledTimes(1);
  });

  it("40001 er bevist avvisning; frigjøring krever eksplisitt valg", async () => {
    RPC.mockResolvedValueOnce({ data: null, error: { code: "40001", message: "Beholdningen er endret" } });
    const h = renderHook(() => useCountSubmission(LE), { wrapper: wrap() });
    await act(async () => { await h.result.current.send(sub()); });
    expect(h.result.current.state.kind).toBe("rejected");
    expect(h.result.current.locked).toBe(true);
    expect(loadPendingSubmission(LE)).not.toBeNull();
    act(() => { expect(h.result.current.release()).toBe(true); });
    expect(h.result.current.locked).toBe(false);
    expect(loadPendingSubmission(LE)).toBeNull();
  });

  it("feilformet suksess lar innsendingen stå som ukjent", async () => {
    RPC.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const h = renderHook(() => useCountSubmission(LE), { wrapper: wrap() });
    await act(async () => { await h.result.current.send(sub()); });
    expect(h.result.current.state.kind).toBe("unknown");
    expect(loadPendingSubmission(LE)?.lines).toEqual(sub().lines);
    expect(new CountRejectedError("content", "x").kind).toBe("content");
  });
});
