import { describe, expect, it } from "vitest";
import { decideHydration } from "@/varer/lib/recipeEditorSync";

const base = {
  loadedRecipeId: null as string | null,
  loadedUpdatedAt: null as string | null,
  incomingRecipeId: "r1" as string | null,
  incomingUpdatedAt: "2026-09-12T10:00:00Z" as string | null,
  dirty: false,
};

describe("hydrering av oppskriftseditoren", () => {
  it("fyller editoren første gang oppskriften åpnes", () => {
    expect(decideHydration(base)).toBe("hydrate");
  });

  it("gjør ingenting når samme versjon kommer inn på nytt", () => {
    expect(
      decideHydration({
        ...base,
        loadedRecipeId: "r1",
        loadedUpdatedAt: "2026-09-12T10:00:00Z",
      }),
    ).toBe("skip");
  });

  it("fyller på nytt når serveren har en nyere versjon og editoren er ren", () => {
    expect(
      decideHydration({
        ...base,
        loadedRecipeId: "r1",
        loadedUpdatedAt: "2026-09-12T10:00:00Z",
        incomingUpdatedAt: "2026-09-12T11:00:00Z",
      }),
    ).toBe("hydrate");
  });

  it("viser konflikt når noen andre har lagret mens du redigerer", () => {
    expect(
      decideHydration({
        ...base,
        loadedRecipeId: "r1",
        loadedUpdatedAt: "2026-09-12T10:00:00Z",
        incomingUpdatedAt: "2026-09-12T11:00:00Z",
        dirty: true,
      }),
    ).toBe("conflict");
  });

  it("beholder det du skriver når samme versjon refetches", () => {
    expect(
      decideHydration({
        ...base,
        loadedRecipeId: "r1",
        loadedUpdatedAt: "2026-09-12T10:00:00Z",
        dirty: true,
      }),
    ).toBe("skip");
  });

  it("bytter til en annen oppskrift", () => {
    expect(
      decideHydration({
        ...base,
        loadedRecipeId: "r0",
        loadedUpdatedAt: "2026-09-12T09:00:00Z",
        dirty: true,
      }),
    ).toBe("hydrate");
  });

  it("gjør ingenting uten serverdata", () => {
    expect(decideHydration({ ...base, incomingRecipeId: null })).toBe("skip");
  });
});
