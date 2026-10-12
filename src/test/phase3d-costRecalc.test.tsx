// @vitest-environment jsdom
/** Fase 3D: faktisk useCostRecalc mot eksakte live-kontrakter (mocket RPC, ingen ekte skriving). */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const st = vi.hoisted(() => ({ entity: "E1" as string | null, canWrite: true, loading: false, rpc: vi.fn(), materials: [] as { id: string }[], cap: 200, pages: 0 }));
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
import { parseRecalcEnvelope, parseUndoEnvelope } from "@/ravarer/lib/recalcContract";

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

describe("kontraktlesere", () => {
  it("dry-run: stokket rekkefølge, null/0-kost og feilet delmengde godtas; avvik er ukjent", () => {
    const e = env([1, 2, 3], true, null, [2]);
    e.items.reverse();
    (e.items[0] as Record<string, unknown>).cost_after = null;
    (e.items[0] as Record<string, unknown>).cost_before = 0;
    const p = parseRecalcEnvelope(e, { ids: [id(1), id(2), id(3)], dryRun: true });
    expect(p?.items.find((i) => !i.ok)).toMatchObject({ message: "Serveren kunne ikke beregne denne råvaren." });
    expect(parseRecalcEnvelope(e, { ids: [id(1), id(2)], dryRun: true })).toBeNull();
    expect(parseRecalcEnvelope({ ...e, dry_run: false }, { ids: [id(1), id(2), id(3)], dryRun: true })).toBeNull();
    expect(parseRecalcEnvelope({ ...e, items: [e.items[0], e.items[0], e.items[1]] }, { ids: [id(1), id(2), id(3)], dryRun: true })).toBeNull();
    expect(parseRecalcEnvelope(env([1], false, B1), { ids: [id(1)], dryRun: false })?.batchId).toBe(B1);
    expect(parseRecalcEnvelope({ ...env([1], false, B1), items: [okItem(1, true)] }, { ids: [id(1)], dryRun: false })).toBeNull();
  });
  it("undo: tellinger må stemme", () => {
    expect(parseUndoEnvelope({ ok: true, batch_id: B1, found: 0, succeeded: 0, failed: 0, items: [] }, B1)?.found).toBe(0);
    expect(parseUndoEnvelope({ ok: true, batch_id: B2, found: 0, succeeded: 0, failed: 0, items: [] }, B1)).toBeNull();
  });
});

describe("useCostRecalc", () => {
  it("forslag kommer fra serverens dry-run", async () => {
    st.materials = [{ id: id(1), name: "Mel", sku: null, base_unit: "kg", current_cost_price: 10 }];
    st.rpc.mockResolvedValue({ data: env([1], true, null), error: null });
    const { result } = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    await act(async () => { await result.current.scan(); });
    expect(st.rpc).toHaveBeenCalledWith("recalc_raw_material_costs", expect.objectContaining({ p_dry_run: true }));
    expect(result.current.rows?.[0]).toMatchObject({ name: "Mel", bucket: "endres" });
    expect(result.current.rows?.[0].proposal?.costAfter).toBe(12);
  });

  it("dobbel kjøring gir ett kall; selskapsbytte mens første bolk venter stopper neste bolk, kvittering beholdes", async () => {
    const ids = Array.from({ length: APPLY_CHUNK + 2 }, (_, i) => i + 1);
    let resolve: (v: unknown) => void = () => undefined;
    st.rpc.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const { result, rerender } = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    let p: Promise<unknown> = Promise.resolve();
    act(() => { p = result.current.apply(ids.map(id)); void result.current.apply(ids.map(id)); });
    expect(st.rpc).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe("apply");
    st.entity = "E2"; rerender();
    await act(async () => { resolve({ data: env(ids.slice(0, APPLY_CHUNK), false, B1), error: null }); await p; });
    expect(st.rpc.mock.calls.filter((c) => c[0] === "recalc_raw_material_costs")).toHaveLength(1);
    // E1-kvitteringen vises ikke under E2, og statistikk kjøres ikke i ny kontekst.
    expect(result.current.ledger.batches).toHaveLength(0);
    expect(result.current.summary).toBeNull();
    expect(st.rpc.mock.calls.some((c) => c[0] === "refresh_purchase_stats")).toBe(false);
    // Angring av E1-kvittering fra E2 sender ingenting.
    await act(async () => { await result.current.undoBatch(B1); });
    expect(st.rpc).toHaveBeenCalledTimes(1);
    st.entity = "E1"; rerender();
    expect(result.current.ledger.batches[0].batchId).toBe(B1);
    expect(result.current.summary?.stopped).toBe("kontekst");
    expect(result.current.summary?.notStartedIds).toHaveLength(2);
  });

  it("delvis bolk + ukjent neste: kvittering og uavklart overlever nullstill/ny skanning", async () => {
    const ids = Array.from({ length: APPLY_CHUNK + 1 }, (_, i) => i + 1);
    st.rpc
      .mockResolvedValueOnce({ data: env(ids.slice(0, APPLY_CHUNK), false, B1, [2]), error: null })
      .mockRejectedValueOnce(new TypeError("net"))
      .mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    await act(async () => { await result.current.apply(ids.map(id)); });
    expect(result.current.ledger.batches[0].items).toHaveLength(APPLY_CHUNK - 1);
    expect(result.current.ledger.batches[0].failures[0].message).not.toContain("intern");
    expect(result.current.ledger.unknownApplies[0].rawMaterialIds).toEqual([id(APPLY_CHUNK + 1)]);
    expect(result.current.summary).toMatchObject({ succeeded: APPLY_CHUNK - 1, failed: 1, linesChanged: APPLY_CHUNK - 1, stopped: "ukjent" });
    act(() => result.current.reset());
    await act(async () => { await result.current.scan(); });
    expect(result.current.ledger.batches).toHaveLength(1);
    expect(result.current.ledger.unknownApplies).toHaveLength(1);
    const calls = st.rpc.mock.calls.filter((c) => c[0] === "recalc_raw_material_costs" && (c[1] as { p_dry_run: boolean }).p_dry_run === false);
    expect(calls).toHaveLength(2); // aldri automatisk nytt forsøk
  });

  it("angring: blandet utfall beholder feilet; null funnet blir uavklart; ukjent svar endrer ingenting", async () => {
    st.rpc.mockResolvedValueOnce({ data: env([1, 2, 3], false, B1), error: null });
    const { result } = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    await act(async () => { await result.current.apply([id(1), id(2), id(3)]); });
    st.rpc.mockResolvedValueOnce({ data: { ok: false, batch_id: B1, found: 2, succeeded: 1, failed: 1, items: [
      { recalc_id: R(1), raw_material_id: id(1), ok: true, lines_restored: 1 },
      { recalc_id: R(2), raw_material_id: id(2), ok: false, error: "x", sqlstate: "42501" },
    ] }, error: null });
    await act(async () => { await result.current.undoBatch(B1); });
    const states = result.current.ledger.batches[0].items.map((i) => i.undo);
    expect(states).toEqual(["angret", "angring_feilet", "uavklart"]);
    st.rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await act(async () => { await result.current.undoBatch(B1); });
    expect(result.current.ledger.batches[0].undoUnknown).toBe(true);
    expect(result.current.ledger.batches[0].items.map((i) => i.undo)).toEqual(["angret", "angring_feilet", "uavklart"]);
  });

  it("uavklart kjøring sperrer ny kjøring av samme vare til eksplisitt kontroll; andre varer går", async () => {
    st.rpc.mockRejectedValueOnce(new TypeError("net"));
    const { result } = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    await act(async () => { await result.current.apply([id(11)]); });
    const opId = result.current.ledger.unknownApplies[0].opId;
    let block: unknown;
    await act(async () => { block = await result.current.apply([id(11), id(12)]); });
    expect(block).toEqual({ blockedIds: [id(11)] });
    expect(st.rpc).toHaveBeenCalledTimes(1);
    expect(result.current.ledger.unknownApplies).toHaveLength(1);
    st.rpc.mockResolvedValueOnce({ data: env([12], false, B2), error: null });
    await act(async () => { await result.current.apply([id(12)]); });
    expect(st.rpc).toHaveBeenCalledTimes(2);
    act(() => result.current.acknowledgeUnknown(opId));
    st.rpc.mockResolvedValueOnce({ data: env([11], false, B1), error: null });
    await act(async () => { await result.current.apply([id(11)]); });
    expect(st.rpc).toHaveBeenCalledTimes(3);
  });

  it("ukjent angring sperrer ny angring til eksplisitt kontroll", async () => {
    st.rpc.mockResolvedValueOnce({ data: env([1], false, B1), error: null }).mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    await act(async () => { await result.current.apply([id(1)]); });
    await act(async () => { await result.current.undoBatch(B1); });
    const n = st.rpc.mock.calls.length;
    await act(async () => { await result.current.undoBatch(B1); });
    expect(st.rpc.mock.calls.length).toBe(n);
    act(() => result.current.acknowledgeUndo(B1));
    st.rpc.mockResolvedValueOnce({ data: { ok: true, batch_id: B1, found: 1, succeeded: 1, failed: 0, items: [{ recalc_id: R(1), raw_material_id: id(1), ok: true, lines_restored: 1 }] }, error: null });
    await act(async () => { await result.current.undoBatch(B1); });
    expect(result.current.ledger.batches[0].items[0].undo).toBe("angret");
  });

  it("skanning: 1201 varer bak servertak 200 hentes komplett", async () => {
    st.materials = Array.from({ length: 1201 }, (_, i) => ({ id: id(i + 1), name: `V${i}`, sku: null, base_unit: "kg", current_cost_price: 1 }));
    st.rpc.mockImplementation(async (_n: string, a: { p_raw_material_ids: string[] }) => ({ data: env(a.p_raw_material_ids.map((x) => Number(x.slice(-12))), true, null), error: null }));
    const { result } = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    await act(async () => { await result.current.scan(); });
    expect(result.current.rows).toHaveLength(1201);
    expect(st.pages).toBeGreaterThan(1);
  });

  it("skanning krever skriverett og ferdig lastet tilgang", async () => {
    st.canWrite = false;
    const { result, rerender } = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    await act(async () => { await result.current.scan(); });
    st.canWrite = true; st.loading = true; rerender();
    await act(async () => { await result.current.scan(); });
    expect(st.rpc).not.toHaveBeenCalled();
    expect(st.pages).toBe(0);
  });

  it("fanget angre-callback etter avmontering sender ingenting", async () => {
    st.rpc.mockResolvedValueOnce({ data: env([1], false, B1), error: null });
    const { result, unmount } = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    await act(async () => { await result.current.apply([id(1)]); });
    const undo = result.current.undoBatch;
    unmount();
    await undo(B1);
    expect(st.rpc).toHaveBeenCalledTimes(1);
  });

  it("dupliserte recalc_id-er i kjøresvar er ukjent", () => {
    const e = env([1, 2], false, B1);
    (e.items[1] as Record<string, unknown>).recalc_id = R(1);
    expect(parseRecalcEnvelope(e, { ids: [id(1), id(2)], dryRun: false })).toBeNull();
  });

  it("uten skriverett sendes ingenting", async () => {
    st.canWrite = false;
    const { result } = renderHook(() => useCostRecalc(), { wrapper: wrap() });
    await act(async () => { await result.current.apply([id(1)]); });
    expect(st.rpc).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.busy).toBeNull());
  });
});
