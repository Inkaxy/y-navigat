// @vitest-environment jsdom
/** Verktøy Matvaretabellen (R108–R115): ekte side/dialog, mocket I/O. Ingen ekte skriving. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { FoodRow } from "@/ravarer/hooks/useMatvaretabellen";
import { parseApplyResult, parseSyncResult, applyResultMessage } from "@/ravarer/lib/matvaretabellenResult";

const state = {
  canWrite: true,
  foods: { data: undefined as FoodRow[] | undefined, isLoading: false, isError: false, error: null as unknown },
  coverage: { data: undefined as unknown, isLoading: false, isError: false },
};
const apply = vi.fn(async (_i: { rawMaterialId: string; foodId: string; force?: boolean }) => ({}));
const refetchFoods = vi.fn();
const refetchCoverage = vi.fn();
let nutritionSource: { source: string; matvaretabellen_food_id: string | null } | null = null;
let deferCheck: ((v: { data: typeof nutritionSource; error: null }) => void) | null = null;
let deferred = false;

vi.mock("@/ravarer/context/RavarerContext", () => ({ useRavarer: () => ({ canWrite: state.canWrite, legalEntityId: "le" }) }));
vi.mock("@/hooks/useUiPreference", () => ({ useUiPreference: <T,>(_s: string, f: T) => ({ value: f, setValue: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/ravarer/components/RavarerHeaderBanner", () => ({ RavarerHeaderBanner: () => null }));
vi.mock("@/ravarer/editors/RawMaterialCreateSheet", () => ({ RawMaterialCreateSheet: () => null }));
vi.mock("@/ravarer/hooks/useNutritionCoverage", () => ({ useNutritionCoverage: () => ({ ...state.coverage, refetch: refetchCoverage }) }));
vi.mock("@/ravarer/hooks/useRawMaterials", () => ({
  useRawMaterials: () => ({ data: [
    { id: "rmA", name: "Hvetemel", sku: "A1", category: "Mel", is_active: true, base_unit: "kg", primary_supplier_id: null },
    { id: "rmB", name: "Rugmel", sku: "B1", category: "Mel", is_active: true, base_unit: "kg", primary_supplier_id: null },
  ], isLoading: false }),
}));
vi.mock("@/ravarer/hooks/useSuppliers", () => ({ useSuppliers: () => ({ data: [] }) }));
vi.mock("@/ravarer/hooks/useMatvaretabellen", () => ({
  useMatvaretabellenFoods: () => ({ ...state.foods, refetch: refetchFoods }),
  useMatvaretabellenLinks: () => ({ data: new Map(), isLoading: false, isError: false, refetch: vi.fn() }),
  useSyncMatvaretabellen: () => ({ mutate: vi.fn(), isPending: false }),
  useApplyMatvaretabellen: () => ({ mutateAsync: apply, isPending: false }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => (deferred
      ? new Promise((resolve) => { deferCheck = resolve; })
      : Promise.resolve({ data: nutritionSource, error: null })) }) }) }),
  },
}));

import Matvaretabellen from "@/ravarer/pages/Matvaretabellen";
import { LinkRawMaterialDialog } from "@/ravarer/components/matvaretabellen/LinkRawMaterialDialog";

const food = (id: string, name: string): FoodRow => ({
  food_id: id, food_name: name, latin_name: null, food_group_id: "g", food_group_name: "Korn", energy_kj: 1400, energy_kcal: 340, fat_g: 1.5, saturated_fat_g: 0.3,
  carbs_g: 70, sugars_g: 1, starch_g: 60, fiber_g: 3, protein_g: 11, salt_g: 0, water_g: 13, edible_part_pct: 100, search_keywords: null, uri: `https://matvaretabellen.no/${id}`, synced_at: "2026-09-01T00:00:00Z",
});
const page = () => render(<MemoryRouter><TooltipProvider><Matvaretabellen /></TooltipProvider></MemoryRouter>);

beforeEach(() => {
  state.canWrite = true;
  state.foods = { data: [food("f1", "Hvetemel, siktet")], isLoading: false, isError: false, error: null };
  state.coverage = { data: { total: 10, complete: 4, incomplete: 3, missing: 3 }, isLoading: false, isError: false };
  apply.mockClear(); nutritionSource = null; deferred = false; deferCheck = null;
});

describe("Matvaretabellen-siden", () => {
  it("feil ved henting av matvarer vises som feil med «Prøv igjen», ikke «ingen treff»", () => {
    state.foods = { data: undefined, isLoading: false, isError: true, error: new Error("x") };
    page();
    expect(screen.queryByText("Ingen matvarer matcher søket.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Prøv igjen/ }));
    expect(refetchFoods).toHaveBeenCalled();
  });
  it("dekning: feil gir feilmelding, aldri «0 %»; lasting viser ikke tall", () => {
    state.coverage = { data: undefined, isLoading: false, isError: true };
    const { unmount } = page();
    expect(screen.getByText(/Kunne ikke hente dekningen/)).toBeInTheDocument();
    expect(screen.queryByText(/0 %/)).toBeNull();
    unmount();
    state.coverage = { data: undefined, isLoading: true, isError: false };
    page();
    expect(screen.getByText(/Laster dekning/)).toBeInTheDocument();
    expect(screen.queryByText(/av 0 matråvarer/)).toBeNull();
  });
  it("lesetilgang: kildelenken er tilgjengelig, skrivehandlinger og synk er skjult", () => {
    state.canWrite = false;
    page();
    expect(screen.getAllByRole("link", { name: /Åpne Hvetemel, siktet i Matvaretabellen/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Handlinger for/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Oppdater fra Matvaretabellen/ })).toBeNull();
  });
  it("menyknappen har tilgjengelig navn", () => {
    page();
    expect(screen.getAllByRole("button", { name: "Handlinger for Hvetemel, siktet" }).length).toBeGreaterThan(0);
  });
});

const dialog = (foodId = "f1", open = true) => <MemoryRouter><LinkRawMaterialDialog open={open} onOpenChange={vi.fn()} foodId={foodId} foodName="Hvetemel" initialQuery="" /></MemoryRouter>;

describe("LinkRawMaterialDialog — overskriving", () => {
  it("uten eksisterende kilde: vanlig kobling (force=false), dialogen står åpen for flere", async () => {
    render(dialog());
    fireEvent.click(screen.getByRole("button", { name: /Hvetemel/ }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls[0][0]).toEqual({ rawMaterialId: "rmA", foodId: "f1", force: false });
    fireEvent.click(screen.getByRole("button", { name: /Rugmel/ }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/2 råvarer koblet/)).toBeInTheDocument();
  });
  it("beskyttet kilde → Avbryt gir 0 kall; Overskriv sender force=true kun for bekreftet mål/matvare", async () => {
    nutritionSource = { source: "datasheet", matvaretabellen_food_id: null };
    render(dialog());
    fireEvent.click(screen.getByRole("button", { name: /Hvetemel/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Avbryt" }));
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Hvetemel/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Overskriv" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls[0][0]).toEqual({ rawMaterialId: "rmA", foodId: "f1", force: true });
  });
  it("sent kildesvar etter bytte av matvare åpner ingen gammel bekreftelse og kobler ikke", async () => {
    deferred = true;
    nutritionSource = { source: "datasheet", matvaretabellen_food_id: null };
    const { rerender } = render(dialog("f1"));
    fireEvent.click(screen.getByRole("button", { name: /Hvetemel/ }));
    rerender(dialog("f2"));
    await act(async () => { deferCheck?.({ data: nutritionSource, error: null }); });
    expect(screen.queryByText("Overskrive næringsdata?")).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("serverresultater", () => {
  it("synk uten ok:true er feil, ikke «0 lagret»", () => {
    expect(() => parseSyncResult({ ok: false, error: "kvote" })).toThrow("kvote");
    expect(() => parseSyncResult({})).toThrow();
    expect(parseSyncResult({ ok: true, foods: 2100, upserted: 2100, groups: 20 }).upserted).toBe(2100);
  });
  it("koblingsresultat viser skrevet/beholdt/overskrevet", () => {
    const r = parseApplyResult({ written: ["fat_g"], skipped: ["salt_g", "protein_g"], forced: false });
    expect(applyResultMessage(r)).toEqual({ tone: "warning", text: "1 felt hentet fra Matvaretabellen · 2 beholdt fra datablad/manuell kilde" });
    expect(applyResultMessage(parseApplyResult({ written: ["fat_g"], skipped: [], forced: true })).text).toContain("(overskrevet)");
    expect(parseApplyResult({ written: "x" })).toBeNull();
    expect(applyResultMessage(null).tone).toBe("warning");
  });
});
