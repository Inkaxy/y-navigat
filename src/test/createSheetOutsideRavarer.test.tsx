// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Ingen RavarerProvider i treet — slik /varer/* er satt opp.
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const k of ["select", "eq", "not", "order", "limit", "or", "in", "ilike"]) chain[k] = vi.fn(self);
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  chain.then = (res: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve(res({ data: [], error: null }));
  return {
    supabase: {
      from: vi.fn(() => chain),
      rpc: vi.fn(async () => ({ data: null, error: null })),
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      auth: { onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })), getSession: vi.fn(async () => ({ data: { session: null } })) },
    },
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" }, session: null, loading: false, signOut: vi.fn() }) }));
vi.mock("@/varer/context/AppContext", () => ({ useAppContext: () => ({ legalEntityId: "le-1" }) }));

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe("Ny råvare utenfor Råvarer-appen (B1)", () => {
  it("RawMaterialAutocomplete rendres uten RavarerProvider", async () => {
    const { RawMaterialAutocomplete } = await import("@/varer/components/products/RawMaterialAutocomplete");
    render(wrap(<RawMaterialAutocomplete value={null} onChange={() => undefined} />));
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("RawMaterialCreateSheet åpnes uten RavarerProvider", async () => {
    const { RawMaterialCreateSheet } = await import("@/ravarer/editors/RawMaterialCreateSheet");
    render(wrap(<RawMaterialCreateSheet open onOpenChange={() => undefined} context={{ kind: "standalone" }} />));
    expect(await screen.findByText("Opprett råvare")).toBeTruthy();
    expect(screen.getByText("Flere felt")).toBeTruthy();
  });
});
