// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { recipeTabForAnchor, recipeTabFrom, recipeTabSearch } from "@/varer/lib/recipeTabs";
import { useRecipeTab } from "@/varer/hooks/useRecipeTab";

describe("faner på oppskriftssiden", () => {
  it("?tab=merking åpner merkefanen; manglende eller ukjent verdi gir Oppskrift", () => {
    expect(recipeTabFrom("?tab=merking")).toBe("merking");
    expect(recipeTabFrom("?tab=varer")).toBe("varer");
    expect(recipeTabFrom("")).toBe("oppskrift");
    expect(recipeTabFrom("?tab=tull")).toBe("oppskrift");
  });

  it("fanebytte bevarer returparameter og rename; standardfanen skrives ikke", () => {
    expect(recipeTabSearch("?fra=abc&rename=1", "varer")).toBe("?fra=abc&rename=1&tab=varer");
    expect(recipeTabSearch("?fra=abc&tab=varer", "oppskrift")).toBe("?fra=abc");
    expect(recipeTabSearch("", "oppskrift")).toBe("");
  });

  it("ankrene peker på riktig fane", () => {
    expect(recipeTabForAnchor("#seksjon-ingredienser")).toBe("oppskrift");
    expect(recipeTabForAnchor("seksjon-info")).toBe("oppskrift");
    expect(recipeTabForAnchor("seksjon-prosess")).toBe("fremgangsmate");
    expect(recipeTabForAnchor("seksjon-notater")).toBe("fremgangsmate");
    expect(recipeTabForAnchor("seksjon-koblinger")).toBe("varer");
    expect(recipeTabForAnchor("seksjon-historikk")).toBe("historikk");
    expect(recipeTabForAnchor("merking-datakvalitet")).toBe("merking");
    expect(recipeTabForAnchor("vare-123")).toBe("varer");
    expect(recipeTabForAnchor("noe-annet")).toBeNull();
  });

  it("fanebytte er ikke en navigasjon: vaktens historikkoppføring og returparameteren bevares", () => {
    window.history.replaceState({ nbhubUnsavedGuard: true }, "", "/varer/oppskrifter/r1?fra=liste");
    const wrapper = ({ children }: { children: ReactNode }) => <BrowserRouter>{children}</BrowserRouter>;
    const { result } = renderHook(() => useRecipeTab(), { wrapper });
    expect(result.current[0]).toBe("oppskrift");
    const lengthBefore = window.history.length;
    act(() => result.current[1]("varer"));
    expect(result.current[0]).toBe("varer");
    expect(window.location.search).toBe("?fra=liste&tab=varer");
    expect((window.history.state as { nbhubUnsavedGuard?: boolean }).nbhubUnsavedGuard).toBe(true);
    expect(window.history.length).toBe(lengthBefore);
  });
});
