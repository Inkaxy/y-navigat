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

describe("useNutritionDraft — bekreftelse av lagret serverrad", () => {
  const withMeta = (r: NutritionRow, extra: Record<string, unknown>) =>
    ({ ...r, ...extra }) as NutritionRow;

  it("blir ren etter lagring selv når serveren endrer kilde og tidsstempel", () => {
    const server = withMeta({ ...row("rm-1", 250), source: "matvaretabellen" }, {
      updated_at: "2026-09-01T10:00:00Z",
    });
    const { result, rerender } = renderHook(
      ({ data }: { data: NutritionRow | null }) => useNutritionDraft("rm-1", data, true),
      { initialProps: { data: server as NutritionRow | null } },
    );

    // Brukeren retter et tall → kilden blir «manuell» ved lagring.
    act(() => result.current.setDraft((d) => ({ ...d, energy_kcal: 999 })));
    expect(result.current.dirty).toBe(true);

    // Utkastet slik det var da lagringen startet; serveren svarer med kilden «manuell».
    const sentDraft: NutritionRow = { ...result.current.draft };
    const saved = withMeta({ ...sentDraft, source: "manuell" }, {
      updated_at: "2026-09-06T20:00:00Z",
      verified_at: "2026-09-06T20:00:00Z",
    });

    act(() => result.current.markSaved(saved, sentDraft));
    expect(result.current.dirty).toBe(false);
    expect(result.current.draft.source).toBe("manuell");
    expect(result.current.draft.energy_kcal).toBe(999);

    // Refetch av samme rad skal heller ikke gjøre skjemaet «endret» igjen.
    rerender({ data: saved });
    expect(result.current.dirty).toBe(false);
  });

  it("bevarer endringer gjort mens lagringen pågikk", () => {
    const { result } = renderHook(
      ({ data }: { data: NutritionRow | null }) => useNutritionDraft("rm-1", data, true),
      { initialProps: { data: row("rm-1", 250) as NutritionRow | null } },
    );
    act(() => result.current.setDraft((d) => ({ ...d, energy_kcal: 999 })));
    const sentDraft: NutritionRow = { ...result.current.draft };

    // Brukeren skriver videre mens lagringen står på.
    act(() => result.current.setDraft((d) => ({ ...d, protein_g: 42 })));

    const saved = withMeta({ ...sentDraft, source: "manuell" }, { updated_at: "2026-09-06T20:00:00Z" });
    act(() => result.current.markSaved(saved, sentDraft));

    expect(result.current.draft.protein_g).toBe(42);
    expect(result.current.draft.energy_kcal).toBe(999);
    expect(result.current.draft.source).toBe("manuell");
    expect(result.current.dirty).toBe(true);
  });

  it("hydrerer ikke en gammel råvare hvis brukeren har byttet under lagring", () => {
    const { result, rerender } = renderHook(
      ({ id, data }: { id: string; data: NutritionRow | null }) => useNutritionDraft(id, data, true),
      { initialProps: { id: "rm-1", data: row("rm-1", 250) as NutritionRow | null } },
    );
    const sentDraft: NutritionRow = { ...result.current.draft, energy_kcal: 999 };
    rerender({ id: "rm-2", data: row("rm-2", 120) });

    act(() => result.current.markSaved({ ...sentDraft }, sentDraft));
    expect(result.current.draft.raw_material_id).toBe("rm-2");
    expect(result.current.draft.energy_kcal).toBe(120);
    expect(result.current.dirty).toBe(false);
  });

  it("servermetadata alene teller ikke som brukerendring", () => {
    const first = withMeta(row("rm-1", 250), { updated_at: "2026-09-01T10:00:00Z" });
    const { result, rerender } = renderHook(
      ({ data }: { data: NutritionRow | null }) => useNutritionDraft("rm-1", data, true),
      { initialProps: { data: first as NutritionRow | null } },
    );
    rerender({
      data: withMeta(row("rm-1", 250), {
        updated_at: "2026-09-06T20:00:00Z",
        verified_by: "en-annen-bruker",
      }),
    });
    expect(result.current.dirty).toBe(false);
  });
});
