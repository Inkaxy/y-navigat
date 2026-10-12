// @vitest-environment jsdom
/** Faktisk hook: utstedt forhandling (fersk lesing) kaller aldri replace_child_rows. */
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({ status: "draft", recipients: [] as Array<{ invited_at: string | null; password_set_at: string | null }>, rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: { status: state.status }, error: null }),
      then: (res: (v: unknown) => void) => res({ data: table === "negotiation_recipients" ? state.recipients : [], error: null }),
    };
    return q;
  };
  return { supabase: { from, rpc: (...a: unknown[]) => { state.rpc(...a); return Promise.resolve({ data: 1, error: null }); } } };
});
vi.mock("@/ravarer/context/RavarerContext", () => ({ useRavarer: () => ({ legalEntityId: "LE", user: { id: "U" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { useUpsertNegotiationItems } from "@/ravarer/hooks/useNegotiations";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useUpsertNegotiationItems", () => {
  it("ekte utkast erstatter", async () => {
    state.status = "draft"; state.recipients = []; state.rpc.mockClear();
    const { result } = renderHook(() => useUpsertNegotiationItems(), { wrapper: wrap() });
    await act(async () => { await result.current.mutateAsync({ negotiationId: "N", items: [{ raw_material_id: "m" }] }); });
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });
  it("utkast som ble utstedt i mellomtiden (fersk lesing) nektes", async () => {
    state.status = "draft"; state.recipients = [{ invited_at: "2026-10-12", password_set_at: null }]; state.rpc.mockClear();
    const { result } = renderHook(() => useUpsertNegotiationItems(), { wrapper: wrap() });
    await act(async () => {
      await expect(result.current.mutateAsync({ negotiationId: "N", items: [{ raw_material_id: "m" }] })).rejects.toThrow();
    });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("status invited nektes", async () => {
    state.status = "invited"; state.recipients = []; state.rpc.mockClear();
    const { result } = renderHook(() => useUpsertNegotiationItems(), { wrapper: wrap() });
    await act(async () => {
      await expect(result.current.mutateAsync({ negotiationId: "N", items: [{ raw_material_id: "m" }] })).rejects.toThrow();
    });
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
