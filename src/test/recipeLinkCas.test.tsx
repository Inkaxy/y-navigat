// @vitest-environment jsdom
/** Oppskriftskobling: betinget skriving + kladdeidentitet (faktiske moduler, mocket spørring). */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

type Call = [string, ...unknown[]];
const st = vi.hoisted(() => ({ calls: [] as Call[], result: { data: [] as unknown, error: null as unknown } as { data: unknown; error: unknown } | "throw" }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const q: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ["update", "delete", "eq", "is"]) q[m] = (...a: unknown[]) => { st.calls.push([m, ...a]); return q; };
    q.select = async (...a: unknown[]) => { st.calls.push(["select", ...a]); if (st.result === "throw") throw new TypeError("net"); return st.result; };
    return q;
  };
  return { supabase: { from: (t: string) => { st.calls.push(["from", t]); return chain(); } } };
});
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null, SelectContent: () => null, SelectItem: () => null,
}));

import { conditionalLinkDelete, conditionalLinkUpdate, linkBaseFrom, type LinkBase } from "@/varer/lib/recipeLinkWrite";
import { SalesUnitSettings } from "@/varer/components/products/SalesUnitSettings";
import { computeSalesUnitBasis } from "@/varer/lib/recipeLinkBasis";

const TS = "2026-10-12T07:08:09.123456+00:00";
const rowA = { id: "L1", product_id: "P1", recipe_id: "RA", updated_at: TS, sales_unit_basis: "flerpakk", units_per_sales_unit: 6, sales_unit_weight_g: 600, units_per_batch_override: 20, sales_unit_confirmed_at: "2026-10-01T10:00:00.5+00:00" };
const rowB = { ...rowA, recipe_id: "RB", updated_at: "2026-10-12T07:09:00.654321+00:00", sales_unit_basis: "stk", units_per_sales_unit: 1, sales_unit_weight_g: 900, units_per_batch_override: null };
const baseA = linkBaseFrom("P1", rowA) as LinkBase;
const baseB = linkBaseFrom("P1", rowB) as LinkBase;
beforeEach(() => { st.calls = []; st.result = { data: [], error: null }; });

describe("betinget skriving", () => {
  it("bygger identitet, rå token og null-sikre predikater i ÉN forespørsel", async () => {
    st.result = { data: [{ ...rowB, sales_unit_confirmed_by: null }], error: null };
    const res = await conditionalLinkUpdate(baseB, { sales_unit_weight_g: 950 }, "RB");
    expect(res.kind).toBe("saved");
    expect(st.calls).toContainEqual(["eq", "id", "L1"]);
    expect(st.calls).toContainEqual(["eq", "product_id", "P1"]);
    expect(st.calls).toContainEqual(["eq", "recipe_id", "RB"]);
    expect(st.calls).toContainEqual(["eq", "updated_at", "2026-10-12T07:09:00.654321+00:00"]);
    expect(st.calls).toContainEqual(["is", "units_per_batch_override", null]);
    expect(st.calls).toContainEqual(["eq", "units_per_sales_unit", 1]);
    expect(st.calls.filter((c) => c[0] === "update")).toHaveLength(1);
    expect(String(st.calls.find((c) => c[0] === "select")?.[1])).toContain("updated_at");
  });
  it("kappløp: serveren har allerede B → [] er konflikt, ingen ny skriving", async () => {
    st.result = { data: [], error: null };
    expect((await conditionalLinkUpdate(baseA, { sales_unit_weight_g: 1 }, "RA")).kind).toBe("conflict");
    expect(st.calls.filter((c) => c[0] === "update")).toHaveLength(1);
  });
  it("feil identitet, feilformet svar og transporttap er ikke suksess", async () => {
    st.result = { data: [{ ...rowA, product_id: "P2", sales_unit_confirmed_by: null }], error: null };
    expect((await conditionalLinkUpdate(baseA, {}, "RA")).kind).toBe("unknown");
    st.result = { data: null, error: null };
    expect((await conditionalLinkUpdate(baseA, {}, "RA")).kind).toBe("unknown");
    st.result = "throw";
    expect((await conditionalLinkUpdate(baseA, {}, "RA")).kind).toBe("unknown");
    st.result = { data: null, error: { code: "42501", message: "x" } };
    expect((await conditionalLinkUpdate(baseA, {}, "RA")).kind).toBe("error");
  });
  it("frakobling mot A etter bytte til B sletter ingenting", async () => {
    st.result = { data: [], error: null };
    expect((await conditionalLinkDelete(baseA)).kind).toBe("conflict");
    expect(st.calls).toContainEqual(["eq", "recipe_id", "RA"]);
  });
  it("manglende token/felt gir ingen basis", () => {
    expect(linkBaseFrom("P1", { ...rowA, updated_at: undefined })).toBeNull();
    const partial: Record<string, unknown> = { ...rowA }; delete partial.units_per_batch_override;
    expect(linkBaseFrom("P1", partial)).toBeNull();
    expect(linkBaseFrom("P1", { ...rowA, id: null })).toBeNull();
  });
});

describe("SalesUnitSettings", () => {
  const val = (id: string) => (screen.getByLabelText(id) as HTMLInputElement).value;
  const ui = (base: LinkBase | null, reset: number, onSave = vi.fn()) =>
    <SalesUnitSettings base={base} canWrite pending={false} resetSignal={reset} onSave={onSave} />;

  it("samme kobling, ny oppskrift B etter bekreftet bytte: kladd og beregning følger B", () => {
    const { rerender } = render(ui(baseA, 0));
    expect(val("Enheter per salgsenhet")).toBe("6");
    rerender(ui(baseB, 1));
    expect(val("Enheter per salgsenhet")).toBe("1");
    expect(val("Vekt per salgsenhet (g)")).toBe("900");
    expect(val("Emner per batch (overstyrt)")).toBe("");
    const recipe = { unitCount: 20, totalDoughG: 18000, finalWeightG: 18000, pieceWeightG: null, totalCost: 200, costIncomplete: false };
    expect(computeSalesUnitBasis(rowB, recipe).costPerSalesUnit).toBeCloseTo(10);
    expect(computeSalesUnitBasis(rowA, recipe).costPerSalesUnit).toBeCloseTo(60);
  });

  it("endret kladd + ny serverversjon: konflikt, kladd beholdt, lagring sperret", () => {
    const onSave = vi.fn();
    const { rerender } = render(ui(baseA, 0, onSave));
    fireEvent.change(screen.getByLabelText("Vekt per salgsenhet (g)"), { target: { value: "650" } });
    const newer = linkBaseFrom("P1", { ...rowA, updated_at: "2026-10-12T08:00:00.000001+00:00", sales_unit_weight_g: 610 }) as LinkBase;
    rerender(ui(newer, 0, onSave));
    expect(screen.getByRole("alert").textContent).toMatch(/endret siden/);
    expect(val("Vekt per salgsenhet (g)")).toBe("650");
    expect((screen.getByRole("button", { name: /Lagre innstillinger/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Forkast kladd/ }));
    expect(val("Vekt per salgsenhet (g)")).toBe("610");
  });

  it("lagring sender den frosne basisen; sen fullføring etter oppskriftsbytte endrer ikke B", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    const onSave = vi.fn(() => new Promise((r) => { resolve = r; }));
    const { rerender } = render(ui(baseA, 0, onSave as never));
    fireEvent.change(screen.getByLabelText("Vekt per salgsenhet (g)"), { target: { value: "620" } });
    fireEvent.click(screen.getByRole("button", { name: /Lagre innstillinger/ }));
    expect(onSave.mock.calls[0][0]).toBe(baseA);
    rerender(ui(baseB, 1, onSave as never));
    await act(async () => { resolve({ kind: "saved", row: { id: "L1", product_id: "P1", recipe_id: "RA", updated_at: TS, settings: { ...baseA.settings, sales_unit_weight_g: 620 }, sales_unit_confirmed_by: null } }); });
    expect(val("Vekt per salgsenhet (g)")).toBe("900");
  });
});
