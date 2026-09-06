// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

/**
 * Regresjon: ["raw_material_nutrition", id] og ["raw_material_allergens", id] ble
 * fylt med boolean/antall fra useRawMaterialPage, mens NutritionTab leste samme
 * nøkler som rad/liste. Resultatet var «$.find is not a function».
 * Testene deler ÉN QueryClient mellom oversikten og fanen — cachen mockes ikke bort.
 */

const RM_ID = "rm-ananas";

let nutritionRow: Record<string, unknown> | null = null;
let allergenRows: Record<string, unknown>[] = [];
let datasheetRows: Record<string, unknown>[] = [];

function result(table: string) {
  switch (table) {
    case "raw_materials":
      return { data: { id: RM_ID, name: "ANANAS FINSKÅRET I JUICE 227G", base_unit: "kg" }, error: null };
    case "raw_material_nutrition":
      return { data: nutritionRow, error: null };
    case "raw_material_allergens":
      return { data: allergenRows, error: null };
    case "raw_material_datasheets":
      return { data: datasheetRows, error: null };
    case "raw_material_suppliers":
      return { data: [{ id: "l1", raw_material_id: RM_ID, supplier_id: "s1", is_primary: true }], error: null };
    case "recipe_lines":
      return { data: [{ recipe_id: "r1" }, { recipe_id: "r1" }, { recipe_id: "r2" }], error: null };
    default:
      return { data: [], error: null };
  }
}

function builder(table: string) {
  const res = result(table);
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "in", "not", "is", "neq", "range", "or", "ilike"]) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = async () => ({ data: Array.isArray(res.data) ? (res.data[0] ?? null) : res.data, error: null });
  chain.single = chain.maybeSingle;
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: Array.isArray(res.data) ? res.data : res.data ? [res.data] : [], error: null }).then(
      resolve,
    );
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => builder(table),
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    functions: { invoke: async () => ({ data: null, error: null }) },
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null }) }) },
  },
}));

vi.mock("@/ravarer/context/RavarerContext", () => ({
  useRavarer: () => ({ canWrite: true, user: { id: "u1" }, accessLevel: "write" }),
}));

import { useRawMaterialPage } from "@/ravarer/hooks/useRawMaterialPage";
import { useAllergens, useNutrition } from "@/ravarer/hooks/useNutrition";
import { NutritionTab } from "@/ravarer/components/tabs/NutritionTab";

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  nutritionRow = {
    raw_material_id: RM_ID,
    energy_kcal: 60,
    energy_kj: 251,
    fat_g: 0.1,
    carbs_g: 14,
    sugars_g: 13,
    protein_g: 0.4,
    salt_g: 0.01,
    ingredient_declaration: "Ananas, juice",
    source: "manual",
  };
  allergenRows = [{ id: "a1", raw_material_id: RM_ID, allergen: "sulphites", presence: "may_contain" }];
  datasheetRows = [{ id: "d1", raw_material_id: RM_ID, is_current: true, uploaded_at: "2026-09-01", file_name: "f.pdf" }];
});

afterEach(() => cleanup());

describe("delt cache mellom råvareoversikt og næringsfane", () => {
  it("oversikt først, deretter fanen: samme nøkler gir rader, ikke boolean/antall", async () => {
    const qc = makeClient();
    const wrapper = wrapperFor(qc);
    const page = renderHook(() => useRawMaterialPage(RM_ID), { wrapper });
    await waitFor(() => expect(page.result.current.rm).not.toBeNull());

    expect(qc.getQueryData(["raw_material_nutrition", RM_ID])).toMatchObject({ energy_kcal: 60 });
    expect(Array.isArray(qc.getQueryData(["raw_material_allergens", RM_ID]))).toBe(true);
    expect(page.result.current.hasNutrition).toBe(true);
    expect(page.result.current.allergenCount).toBe(1);
    expect(page.result.current.hasDatasheet).toBe(true);
    expect(page.result.current.recipeCount).toBe(2);

    const hooks = renderHook(() => ({ n: useNutrition(RM_ID), a: useAllergens(RM_ID) }), { wrapper });
    // Verdiene kommer rett fra den delte cachen — ingen ny henting kreves.
    expect(hooks.result.current.n.data?.energy_kcal).toBe(60);
    expect(hooks.result.current.a.data?.find((x) => x.allergen === "sulphites")?.presence).toBe("may_contain");

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <NutritionTab rawMaterialId={RM_ID} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByDisplayValue("60")).toBeTruthy());
    expect(screen.getByDisplayValue("Ananas, juice")).toBeTruthy();
  });

  it("fanen først, deretter oversikten: KPI-tallene stemmer uten ny type i cachen", async () => {
    const qc = makeClient();
    const wrapper = wrapperFor(qc);
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <NutritionTab rawMaterialId={RM_ID} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByDisplayValue("60")).toBeTruthy());

    const page = renderHook(() => useRawMaterialPage(RM_ID), { wrapper });
    await waitFor(() => expect(page.result.current.rm).not.toBeNull());
    expect(page.result.current.hasNutrition).toBe(true);
    expect(page.result.current.allergenCount).toBe(1);
    expect(qc.getQueryData(["raw_material_nutrition", RM_ID])).toMatchObject({ raw_material_id: RM_ID });
  });

  it("uten næringsrad og uten allergener krasjer ingenting", async () => {
    nutritionRow = null;
    allergenRows = [];
    datasheetRows = [];
    const qc = makeClient();
    const wrapper = wrapperFor(qc);
    const page = renderHook(() => useRawMaterialPage(RM_ID), { wrapper });
    await waitFor(() => expect(page.result.current.rm).not.toBeNull());
    expect(page.result.current.hasNutrition).toBe(false);
    expect(page.result.current.allergenCount).toBe(0);
    expect(page.result.current.hasDatasheet).toBe(false);

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <NutritionTab rawMaterialId={RM_ID} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0));
    expect(qc.getQueryData(["raw_material_allergens", RM_ID])).toEqual([]);
  });

  it("KPI-status oppdateres etter invalidering av de delte nøklene", async () => {
    nutritionRow = null;
    allergenRows = [];
    const qc = makeClient();
    const wrapper = wrapperFor(qc);
    const page = renderHook(() => useRawMaterialPage(RM_ID), { wrapper });
    await waitFor(() => expect(page.result.current.rm).not.toBeNull());
    expect(page.result.current.hasNutrition).toBe(false);

    nutritionRow = { raw_material_id: RM_ID, energy_kcal: 42 };
    allergenRows = [{ id: "a2", raw_material_id: RM_ID, allergen: "milk", presence: "contains" }];
    await qc.invalidateQueries({ queryKey: ["raw_material_nutrition", RM_ID] });
    await qc.invalidateQueries({ queryKey: ["raw_material_allergens", RM_ID] });

    await waitFor(() => expect(page.result.current.hasNutrition).toBe(true));
    expect(page.result.current.allergenCount).toBe(1);
    expect(page.result.current.nutrition?.energy_kcal).toBe(42);
  });
});
