// @vitest-environment jsdom
/** Ekte hook: sertifiserer bare komplett, fersk og ferdig hentet bevis for gjeldende selskap. Mocket RPC. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const V = "2026-10-11T12:00:00.123456+00:00";
const calls: { entity: string; ids: string[] }[] = [];
let gate: Promise<void> | null = null;
let fail = false;
const row = (id: string) => ({
  raw_material_id: id, material_updated_at: V, status: "unknown", reason: "no_invoice_observation", cost_reason: null, invoice_reason: "no_invoice_observation",
  cost_evidence_status: "eligible", invoice_evidence_status: "unknown", current_price: 1, cost_basis_status: "verifisert", base_unit: "kg",
  cost_effective_date: null, invoice_id: null, invoice_line_id: null, invoice_number: null, invoice_date: null, invoice_price_per_base_unit: null, currency: null, deviation_pct: null,
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (_n: string, a: { p_legal_entity_id: string; p_raw_material_ids: string[] }) => ({
    abortSignal: () => ({
      then: async (ok: (v: unknown) => unknown) => {
        calls.push({ entity: a.p_legal_entity_id, ids: a.p_raw_material_ids });
        if (gate) await gate;
        if (fail) return ok({ data: null, error: { message: "x" } });
        return ok({ data: { schema_version: 1, legal_entity_id: a.p_legal_entity_id, checked_at: V, requested_count: a.p_raw_material_ids.length, rows: a.p_raw_material_ids.map(row) }, error: null });
      },
    }),
  }) },
}));
import { useListPriceEvidence } from "@/ravarer/hooks/useListPriceEvidence";

const ids = Array.from({ length: 391 }, (_, i) => `m${i}`);
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => { calls.length = 0; gate = null; fail = false; client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });

describe("useListPriceEvidence", () => {
  it("391 råvarer: 4 kall, sertifisert først når alt er ferdig", async () => {
    let release!: () => void;
    gate = new Promise((r) => { release = r; });
    const { result } = renderHook(() => useListPriceEvidence("A", ids, true), { wrapper });
    expect(result.current.certified).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () => { release(); });
    await waitFor(() => expect(result.current.certified?.byId.size).toBe(391));
    expect(calls).toHaveLength(4);
    expect(result.current.checkedAt).toBe(V);
  });
  it("oppfrisking pågår: gammelt bevis sertifiserer ikke", async () => {
    const { result } = renderHook(() => useListPriceEvidence("A", ids.slice(0, 3), true), { wrapper });
    await waitFor(() => expect(result.current.certified).not.toBeNull());
    let release!: () => void;
    gate = new Promise((r) => { release = r; });
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.certified).toBeNull());
    await act(async () => { release(); });
    await waitFor(() => expect(result.current.certified).not.toBeNull());
  });
  it("selskapsbytte: ingen sertifisering fra forrige selskap", async () => {
    const { result, rerender } = renderHook(({ e }) => useListPriceEvidence(e, ids.slice(0, 3), true), { wrapper, initialProps: { e: "A" } });
    await waitFor(() => expect(result.current.certified).not.toBeNull());
    gate = new Promise(() => undefined);
    rerender({ e: "B" });
    expect(result.current.certified).toBeNull();
  });
  it("feil: ingen sertifisering, én liste-status", async () => {
    fail = true;
    const { result } = renderHook(() => useListPriceEvidence("A", ids.slice(0, 3), true), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 4000 });
    expect(calls).toHaveLength(2); // ett nytt forsøk, ingen storm
    expect(result.current.certified).toBeNull();
  });
});
