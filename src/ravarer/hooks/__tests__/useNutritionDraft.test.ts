// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNutritionDraft, emptyNutritionFor } from "@/ravarer/hooks/useNutritionDraft";
import type { NutritionRow } from "@/ravarer/hooks/useNutrition";

const row = (id: string, kcal: number): NutritionRow => ({
  ...emptyNutritionFor(id),
  energy_kcal: kcal,
  protein_g: 10,
});

describe("useNutritionDraft", () => {
  it("hydrerer når første svar kommer etter render (kald åpning)", () => {
    const { result, rerender } = renderHook(
      ({ data, loaded }: { data: NutritionRow | null | undefined; loaded: boolean }) =>
        useNutritionDraft("rm-1", data, loaded),
      { initialProps: { data: undefined as NutritionRow | null | undefined, loaded: false } },
    );

    expect(result.current.hydrated).toBe(false);
    expect(result.current.dirty).toBe(false);

    rerender({ data: row("rm-1", 250), loaded: true });

    expect(result.current.hydrated).toBe(true);
    expect(result.current.draft.energy_kcal).toBe(250);
    expect(result.current.dirty).toBe(false);
  });

  it("oppdaterer urørt skjema ved refetch", () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: NutritionRow | null }) => useNutritionDraft("rm-1", data, true),
      { initialProps: { data: row("rm-1", 250) as NutritionRow | null } },
    );
    rerender({ data: row("rm-1", 300) });
    expect(result.current.draft.energy_kcal).toBe(300);
    expect(result.current.dirty).toBe(false);
  });

  it("beholder brukerutkast ved refetch", () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: NutritionRow | null }) => useNutritionDraft("rm-1", data, true),
      { initialProps: { data: row("rm-1", 250) as NutritionRow | null } },
    );
    act(() => result.current.setDraft(d => ({ ...d, energy_kcal: 999 })));
    expect(result.current.dirty).toBe(true);

    rerender({ data: row("rm-1", 300) });
    expect(result.current.draft.energy_kcal).toBe(999);
    expect(result.current.dirty).toBe(true);
  });

  it("er ren igjen når lagringen kommer tilbake fra serveren", () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: NutritionRow | null }) => useNutritionDraft("rm-1", data, true),
      { initialProps: { data: row("rm-1", 250) as NutritionRow | null } },
    );
    act(() => result.current.setDraft(d => ({ ...d, energy_kcal: 999 })));
    rerender({ data: { ...row("rm-1", 999) } });
    expect(result.current.dirty).toBe(false);
  });

  it("nullstiller ved bytte av råvare", () => {
    const { result, rerender } = renderHook(
      ({ id, data }: { id: string; data: NutritionRow | null }) => useNutritionDraft(id, data, true),
      { initialProps: { id: "rm-1", data: row("rm-1", 250) as NutritionRow | null } },
    );
    act(() => result.current.setDraft(d => ({ ...d, energy_kcal: 999 })));
    rerender({ id: "rm-2", data: row("rm-2", 120) });
    expect(result.current.draft.energy_kcal).toBe(120);
    expect(result.current.dirty).toBe(false);
  });

  it("tom rad gir tomt skjema uten å bli markert endret", () => {
    const { result, rerender } = renderHook(
      ({ data, loaded }: { data: NutritionRow | null; loaded: boolean }) => useNutritionDraft("rm-3", data, loaded),
      { initialProps: { data: null as NutritionRow | null, loaded: false } },
    );
    rerender({ data: null, loaded: true });
    expect(result.current.hydrated).toBe(true);
    expect(result.current.draft.raw_material_id).toBe("rm-3");
    expect(result.current.dirty).toBe(false);
  });
});
