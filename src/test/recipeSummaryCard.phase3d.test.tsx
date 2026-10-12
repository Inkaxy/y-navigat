// @vitest-environment jsdom
/** Fullt RecipeSummaryCard: frosset frakoblingsgrunnlag og eksakt ID ved ny kobling (mocket I/O). */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

type Call = [string, ...unknown[]];
const st = vi.hoisted(() => ({
  calls: [] as Call[],
  result: { data: [] as unknown, error: null as unknown },
  bundle: null as unknown,
  hasRecipe: true,
  audit: vi.fn(),
  toastOk: vi.fn(), toastErr: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const q: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ["update", "delete", "insert", "eq", "is", "order", "limit"]) q[m] = (...a: unknown[]) => { st.calls.push([m, ...a]); return q; };
    q.maybeSingle = async () => ({ data: null, error: null });
    q.select = (...a: unknown[]) => { st.calls.push(["select", ...a]); const p = Promise.resolve(st.result); return Object.assign(p, q); };
    return q;
  };
  return { supabase: { from: (t: string) => { st.calls.push(["from", t]); return chain(); } } };
});
vi.mock("@/varer/hooks/useProductRecipeLink", () => ({
  PRODUCT_RECIPE_LINK_KEY: (id: string) => ["prl", id],
  useProductRecipeLink: () => ({ bundle: st.bundle, isLoading: false, hasRecipe: st.hasRecipe }),
}));
vi.mock("@/varer/hooks/useStockTrackedRawMaterials", () => ({ useStockTrackedRawMaterials: () => ({ data: new Set() }) }));
vi.mock("@/varer/lib/audit", () => ({ logAudit: (...a: unknown[]) => st.audit(...a) }));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => st.toastOk(...a), error: (...a: unknown[]) => st.toastErr(...a), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/varer/components/products/LinkRecipeDialog", () => ({
  LinkRecipeDialog: ({ open, onConfirm }: { open: boolean; onConfirm: (s: unknown) => void }) =>
    open ? <button onClick={() => onConfirm({ recipeId: "RN", salesUnitBasis: "stk", unitsPerSalesUnit: 1, salesUnitWeightG: null, unitsPerBatchOverride: null })}>Velg RN</button> : null,
}));
vi.mock("@/varer/components/products/SalesUnitSettings", () => ({ SalesUnitSettings: () => null }));

import { RecipeSummaryCard } from "@/varer/components/products/RecipeSummaryCard";

const rowA = { id: "L1", product_id: "P1", recipe_id: "RA", updated_at: "2026-10-12T07:08:09.123456+00:00", sales_unit_basis: "flerpakk", units_per_sales_unit: 6, sales_unit_weight_g: 600, units_per_batch_override: 20, sales_unit_confirmed_at: null, sales_unit_confirmed_by: null };
const rowB = { ...rowA, recipe_id: "RB", updated_at: "2026-10-12T07:09:00.654321+00:00" };
const nullish = () => new Proxy({}, { get: (_t, k) => (k === "then" ? undefined : k === "missing" ? [] : null) });
const bundleFor = (link: typeof rowA | null, name: string) => ({
  link, recipe: link ? { id: link.recipe_id, name, version: 1, status: "approved", updated_at: "2026-10-01T00:00:00Z" } : null,
  lines: [], basis: nullish(), cost: nullish(), totalFlourG: 0, hydrationPct: null, totalDoughG: 0, finalWeightG: null, unitCount: null,
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = () => <QueryClientProvider client={qc}><MemoryRouter><RecipeSummaryCard productId="P1" productName="Brød" legalEntityId="E1" canWrite /></MemoryRouter></QueryClientProvider>;
  const r = render(ui());
  return { rerender: () => r.rerender(ui()) };
}
beforeEach(() => { st.calls = []; st.result = { data: [], error: null }; st.hasRecipe = true; st.audit.mockReset(); st.toastOk.mockReset(); st.toastErr.mockReset(); });

describe("RecipeSummaryCard", () => {
  it("frakobling bruker grunnlaget som ble vist ved åpning, ikke nyere refetch (B)", async () => {
    st.bundle = bundleFor(rowA, "Oppskrift A");
    const { rerender } = mount();
    fireEvent.click(screen.getByRole("button", { name: /Fjern kobling/ }));
    expect(screen.getByText(/Fjerne koblingen til «Oppskrift A»/)).toBeTruthy();
    st.bundle = bundleFor(rowB, "Oppskrift B"); rerender();
    expect(screen.getByText(/Fjerne koblingen til «Oppskrift A»/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/endret siden du åpnet/);
    st.result = { data: [], error: null }; // serveren har B → betinget sletting treffer ingenting
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Fjern kobling" }).at(-1) as HTMLElement); });
    expect(st.calls).toContainEqual(["eq", "recipe_id", "RA"]);
    expect(st.calls).toContainEqual(["eq", "updated_at", rowA.updated_at]);
    expect(st.calls).not.toContainEqual(["eq", "recipe_id", "RB"]);
    expect(st.audit).not.toHaveBeenCalled();
  });

  it("ny kobling uten returnert ID er ukjent: ingen revisjon eller suksess", async () => {
    st.hasRecipe = false; st.bundle = bundleFor(null, "");
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Koble eksisterende oppskrift/ }));
    st.result = { data: [{ product_id: "P1", recipe_id: "RN" }], error: null };
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Velg RN" })); });
    await waitFor(() => expect(st.toastErr).toHaveBeenCalled());
    expect(String(st.toastErr.mock.calls[0][0])).toMatch(/vet ikke/);
    expect(st.audit).not.toHaveBeenCalled();
    expect(st.toastOk).not.toHaveBeenCalled();
    expect(st.calls.filter((c) => c[0] === "update")).toHaveLength(0);
  });

  it("ny kobling med eksakt ID/produkt/oppskrift godtas", async () => {
    st.hasRecipe = false; st.bundle = bundleFor(null, "");
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Koble eksisterende oppskrift/ }));
    st.result = { data: [{ id: "L9", product_id: "P1", recipe_id: "RN" }], error: null };
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Velg RN" })); });
    await waitFor(() => expect(st.audit).toHaveBeenCalled());
  });
});
