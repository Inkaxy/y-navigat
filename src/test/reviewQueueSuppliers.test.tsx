// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * Regresjon: fakturainnboksen startet på legalEntityId="all" og kalte
 * useSuppliersFor(null), som er `enabled: false`. I ett-firma-oppsettet ble
 * leverandørlisten derfor ALDRI hentet, uansett hvordan knappen var deaktivert.
 */

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const supplierFilters: (string | null)[] = [];

function builder(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "in", "not", "is", "neq", "range", "or", "ilike"]) {
    chain[m] = () => chain;
  }
  chain.eq = (col: string, val: string) => {
    if (table === "suppliers" && col === "legal_entity_id") supplierFilters.push(val);
    return chain;
  };
  const rows =
    table === "suppliers"
      ? [
          {
            id: "s1",
            legal_entity_id: COMPANY_ID,
            name: "Bakermel AS",
            org_number: "999",
            contact_email: null,
            is_active: true,
          },
        ]
      : [];
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => builder(table) },
}));

import { useSuppliersFor } from "@/fakturaer/hooks/useSuppliersFor";
import { resolveQueueEntityId } from "@/fakturaer/lib/queueEntity";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("resolveQueueEntityId", () => {
  it("bruker firmaet fra useCompany", () => {
    expect(resolveQueueEntityId(COMPANY_ID, [COMPANY_ID])).toBe(COMPANY_ID);
  });

  it("faller tilbake på det eneste selskapet brukeren har tilgang til", () => {
    expect(resolveQueueEntityId(null, ["e1"])).toBe("e1");
    expect(resolveQueueEntityId(undefined, ["e1"])).toBe("e1");
  });

  it("returnerer aldri «alle» når firmaet er kjent", () => {
    expect(resolveQueueEntityId(COMPANY_ID, [])).toBe(COMPANY_ID);
  });

  it("gir null bare når tilgangen faktisk spenner over flere selskaper", () => {
    expect(resolveQueueEntityId(null, ["e1", "e2"])).toBeNull();
    expect(resolveQueueEntityId("ukjent", ["e1", "e2"])).toBeNull();
  });
});

describe("leverandørvalget i fakturainnboksen", () => {
  beforeEach(() => {
    supplierFilters.length = 0;
  });

  it("henter leverandører for det ene firmaet", async () => {
    const entityId = resolveQueueEntityId(COMPANY_ID, [COMPANY_ID]);
    const { result } = renderHook(() => useSuppliersFor(entityId), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].name).toBe("Bakermel AS");
    expect(supplierFilters).toEqual([COMPANY_ID]);
  });

  it("henter ingenting uten selskap — derav regresjonen", async () => {
    const { result } = renderHook(() => useSuppliersFor(null), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
    expect(supplierFilters).toEqual([]);
  });
});
