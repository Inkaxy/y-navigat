// @vitest-environment jsdom
/** Fase 3D: faktisk useCostRecalc mot eksakte live-kontrakter (mocket RPC, ingen ekte skriving). */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const st = vi.hoisted(() => ({ entity: "E1" as string | null, canWrite: true, loading: false, rpc: vi.fn(), materials: [] as ({ id: string } & Record<string, unknown>)[], cap: 200, pages: 0 }));
vi.mock("@/integrations/supabase/client", () => {
  const from = () => {
    const s: { head: boolean; gt: string | null; limit: number } = { head: false, gt: null, limit: 1e9 };
    const q = {
      select: (_c: string, o?: { head?: boolean }) => { s.head = !!o?.head; return q; },
      eq: () => q, order: () => q,
      gt: (_k: string, v: string) => { s.gt = v; return q; },
      limit: (n: number) => { s.limit = n; return q; },
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => {
        if (s.head) return Promise.resolve({ count: st.materials.length, error: null }).then(ok, bad);
        st.pages++;
        const rest = st.materials.filter((m) => !s.gt || m.id > s.gt);
        return Promise.resolve({ data: rest.slice(0, Math.min(s.limit, st.cap)), error: null }).then(ok, bad);
      },
    };
    return q;
  };
  return { supabase: { from, rpc: (...a: unknown[]) => st.rpc(...a) } };
});
vi.mock("@/ravarer/context/RavarerContext", () => ({ useRavarer: () => ({ legalEntityId: st.entity, canWrite: st.canWrite, loading: st.loading }) }));
vi.mock("@/ravarer/lib/invalidate", () => ({ invalidateRawMaterial: vi.fn() }));

import { useCostRecalc, APPLY_CHUNK, __resetCostRecalcMemory } from "@/fakturaer/hooks/useCostRecalc";

const writes = () => st.rpc.mock.calls.filter((c) => c[0] !== "refresh_purchase_stats").length;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const B1 = "11111111-1111-4111-8111-111111111111", B2 = "22222222-2222-4222-8222-222222222222";
const R = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;
const okItem = (n: number, dry: boolean, extra: Record<string, unknown> = {}) => ({ raw_material_id: id(n), ok: true, raw_material: `Vare ${n}`, recalc_id: dry ? null : R(n), lines_total: 2, lines_changed: 1, lines_unknown: 0, lines_excluded: 0, cost_before: 10, cost_after: 12, manual_cost_protected: false, ...extra });
function env(ids: number[], dry: boolean, batch: string | null, fail: number[] = []) {
  const items = ids.map((n) => (fail.includes(n) ? { raw_material_id: id(n), ok: false, error: "intern detalj", sqlstate: "XX000" } : okItem(n, dry)));
  const ok = items.filter((i) => i.ok).length;
  return { ok: fail.length === 0, dry_run: dry, batch_id: batch, requested: ids.length, succeeded: ok, failed: ids.length - ok, lines_changed: ok, items };
}
function wrap() {
  const qc = new QueryClient();
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
beforeEach(() => { st.entity = "E1"; st.canWrite = true; st.loading = false; st.rpc.mockReset(); st.materials = []; st.cap = 200; st.pages = 0; __resetCostRecalcMemory(); });

const deferred = <T,>() => { let res!: (v: T) => void; const p = new Promise<T>((r) => { res = r; }); return { p, res }; };
const unknownErr = { data: null, error: { message: "nett" } };

describe("fanehukommelse: identitet, avvisning, overlapp, eierskap", () => {
  it("operasjons-ID er unik på tvers av remontering; kvittering av én frigjør ikke den andre", async () => {
    st.rpc.mockResolvedValue(unknownErr);
    const a = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    await act(async () => { await a.result.current.apply([id(1)]); });
    a.unmount();
    const b = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    await act(async () => { await b.result.current.apply([id(2)]); });
    const ops = b.result.current.ledger.unknownApplies.map((u) => u.opId);
    expect(new Set(ops).size).toBe(2);
    act(() => b.result.current.acknowledgeUnknown(ops[0]));
    expect(b.result.current.ledger.unknownApplies.map((u) => u.rawMaterialIds[0])).toEqual([id(2)]);
    let block: unknown;
    await act(async () => { block = await b.result.current.apply([id(2)]); });
    expect(block).toEqual({ blockedIds: [id(2)] });
  });

  it.each(["08007", "40003", "08006", "57P01", "XX000", "ABCDE"])("%s er ukjent utfall (kjøring)", async (code) => {
    st.rpc.mockResolvedValue({ data: null, error: { code, message: "x" } });
    const { result } = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    await act(async () => { await result.current.apply([id(1)]); });
    expect(result.current.summary?.unknownIds).toEqual([id(1)]);
    expect(result.current.ledger.unknownApplies).toHaveLength(1);
  });
  it("42501 er kjent avvisning: feilet, ingen uavklart post", async () => {
    st.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "x" } });
    const { result } = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    await act(async () => { await result.current.apply([id(1)]); });
    expect(result.current.summary?.failed).toBe(1);
    expect(result.current.ledger.unknownApplies).toHaveLength(0);
  });
  it("angring med 08007 blir uavklart (samme klassifisering)", async () => {
    st.rpc.mockResolvedValueOnce({ data: env([1], false, B1), error: null }).mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "08007", message: "x" } });
    const { result } = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    await act(async () => { await result.current.apply([id(1)]); });
    await act(async () => { await result.current.undoBatch(B1); });
    expect(result.current.ledger.batches[0].undoUnknown).toBe(true);
  });

  it("angring av eldre kvittering sperres når nyere kjøring på samme vare er uavklart", async () => {
    st.rpc.mockResolvedValueOnce({ data: env([1], false, B1), error: null }).mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce(unknownErr);
    const { result } = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    await act(async () => { await result.current.apply([id(1)]); });
    await act(async () => { await result.current.apply([id(1)]); });
    const before = writes();
    await act(async () => { await result.current.undoBatch(B1); });
    expect(writes()).toBe(before);
    expect(result.current.error).toMatch(/sperret/);
  });

  it("ventende skriving: remontert side ser den, kan ikke dobbeltskrive, får sen kvittering uten ny gjengivelse", async () => {
    const d = deferred<unknown>();
    st.rpc.mockImplementation((n: string) => (n === "refresh_purchase_stats" ? Promise.resolve({ error: null }) : d.p));
    const a = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    let first!: Promise<unknown>;
    act(() => { first = a.result.current.apply([id(1)]); });
    a.unmount();
    const b = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    expect(b.result.current.pending.map((p) => p.rawMaterialIds)).toEqual([[id(1)]]);
    let block: unknown;
    await act(async () => { block = await b.result.current.apply([id(1)]); });
    expect(block).toEqual({ blockedIds: [id(1)] });
    expect(writes()).toBe(1);
    await act(async () => { d.res({ data: env([1], false, B1), error: null }); await first; });
    await waitFor(() => expect(b.result.current.ledger.batches.map((x) => x.batchId)).toEqual([B1]));
    expect(b.result.current.pending).toEqual([]);
    expect(b.result.current.summary?.succeeded).toBe(1);
  });

  it("ikke-relatert vare kan kjøres mens en annen venter; sen fullføring publiseres bare til eget selskap", async () => {
    const d = deferred<unknown>();
    st.rpc.mockImplementationOnce(() => d.p).mockResolvedValue({ data: env([2], false, B2), error: null });
    const a = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    let first!: Promise<unknown>;
    act(() => { first = a.result.current.apply([id(1)]); });
    a.unmount();
    const b = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    await act(async () => { await b.result.current.apply([id(2)]); });
    expect(b.result.current.ledger.batches.map((x) => x.batchId)).toEqual([B2]);
    st.entity = "E2"; b.rerender();
    await act(async () => { d.res({ data: env([1], false, B1), error: null }); await first; });
    expect(b.result.current.ledger.batches).toEqual([]);
    expect(b.result.current.pending).toEqual([]);
    st.entity = "E1"; b.rerender();
    expect(b.result.current.ledger.batches.map((x) => x.batchId).sort()).toEqual([B1, B2].sort());
  });

  it("avbrudd: ikke-startede bolker frigjøres (ingen evig sperre), sendt-ukjent blir egen post", async () => {
    const d = deferred<unknown>();
    st.rpc.mockImplementationOnce(() => d.p);
    const ids = Array.from({ length: APPLY_CHUNK + 3 }, (_, i) => id(i + 1));
    const { result } = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    let run!: Promise<unknown>;
    act(() => { run = result.current.apply(ids); });
    act(() => result.current.cancel());
    await act(async () => { d.res(unknownErr); await run; });
    expect(result.current.pending).toEqual([]);
    expect(result.current.ledger.unknownApplies[0].rawMaterialIds).toHaveLength(APPLY_CHUNK);
    expect(result.current.summary?.notStartedIds).toHaveLength(3);
    st.rpc.mockResolvedValue({ data: env([APPLY_CHUNK + 1], false, B2), error: null });
    await act(async () => { await result.current.apply([id(APPLY_CHUNK + 1)]); });
    expect(result.current.ledger.batches.map((x) => x.batchId)).toEqual([B2]);
  });

  it("ny skanning sletter ikke ventende/uavklart/kvitteringer", async () => {
    st.rpc.mockResolvedValueOnce({ data: env([1], false, B1), error: null }).mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce(unknownErr);
    const { result } = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    await act(async () => { await result.current.apply([id(1)]); });
    await act(async () => { await result.current.apply([id(2)]); });
    st.materials = [{ id: id(3), name: "X", sku: null, base_unit: "kg", current_cost_price: 1 }];
    st.rpc.mockResolvedValue({ data: env([3], true, null), error: null });
    await act(async () => { await result.current.scan(); });
    expect(result.current.ledger.batches).toHaveLength(1);
    expect(result.current.ledger.unknownApplies).toHaveLength(1);
  });
});
