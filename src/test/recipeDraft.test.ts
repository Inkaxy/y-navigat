import { describe, expect, it } from "vitest";
import {
  clearDraft,
  draftHasConflict,
  draftIsRelevant,
  draftKey,
  readDraft,
  writeDraft,
  type RecipeDraftPayload,
} from "@/varer/hooks/useRecipeDraft";

/** Enkel in-memory implementasjon av Storage-grensesnittet. */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

function createThrowingStorage(): Storage {
  return {
    length: 0,
    clear: () => {
      throw new Error("full");
    },
    getItem: () => {
      throw new Error("full");
    },
    key: () => null,
    removeItem: () => {
      throw new Error("full");
    },
    setItem: () => {
      throw new Error("full");
    },
  };
}

describe("writeDraft og readDraft", () => {
  it("lagrer og leser tilbake et utkast", () => {
    const storage = createMemoryStorage();
    const payload: RecipeDraftPayload<{ tittel: string }> = {
      data: { tittel: "Grovbrød" },
      savedAt: new Date().toISOString(),
      baseUpdatedAt: "2024-01-01T00:00:00.000Z",
    };
    writeDraft("oppskrift-1", payload, storage);
    const lest = readDraft<{ tittel: string }>("oppskrift-1", storage);
    expect(lest).toEqual(payload);
    expect(storage.getItem(draftKey("oppskrift-1"))).not.toBeNull();
  });

  it("gir null for ugyldig JSON og fjerner nøkkelen", () => {
    const storage = createMemoryStorage();
    storage.setItem(draftKey("oppskrift-2"), "{ ikke gyldig json");
    const lest = readDraft("oppskrift-2", storage);
    expect(lest).toBeNull();
    expect(storage.getItem(draftKey("oppskrift-2"))).toBeNull();
  });

  it("gir null for gyldig JSON med feil form og fjerner nøkkelen", () => {
    const storage = createMemoryStorage();
    storage.setItem(draftKey("oppskrift-3"), JSON.stringify({ noe: "annet" }));
    const lest = readDraft("oppskrift-3", storage);
    expect(lest).toBeNull();
    expect(storage.getItem(draftKey("oppskrift-3"))).toBeNull();
  });

  it("velter ikke ved kastende storage", () => {
    const storage = createThrowingStorage();
    expect(() =>
      writeDraft(
        "oppskrift-4",
        { data: {}, savedAt: new Date().toISOString(), baseUpdatedAt: null },
        storage,
      ),
    ).not.toThrow();
  });
});

describe("clearDraft", () => {
  it("fjerner utkastet fra storage", () => {
    const storage = createMemoryStorage();
    writeDraft("oppskrift-5", { data: {}, savedAt: new Date().toISOString(), baseUpdatedAt: null }, storage);
    clearDraft("oppskrift-5", storage);
    expect(storage.getItem(draftKey("oppskrift-5"))).toBeNull();
  });
});

describe("draftIsRelevant", () => {
  it("er usann når utkastet mangler", () => {
    expect(draftIsRelevant(null, null)).toBe(false);
  });

  it("er usann når savedAt ikke er en gyldig dato", () => {
    const draft: RecipeDraftPayload<unknown> = { data: {}, savedAt: "ugyldig-dato", baseUpdatedAt: null };
    expect(draftIsRelevant(draft, null)).toBe(false);
  });

  it("er sann når utkastet finnes og har en gyldig savedAt", () => {
    const draft: RecipeDraftPayload<unknown> = {
      data: {},
      savedAt: new Date().toISOString(),
      baseUpdatedAt: "2024-01-01T00:00:00.000Z",
    };
    expect(draftIsRelevant(draft, "2024-02-01T00:00:00.000Z")).toBe(true);
  });
});

describe("draftHasConflict", () => {
  it("er sann når baseUpdatedAt og serverUpdatedAt er ulike", () => {
    const draft: RecipeDraftPayload<unknown> = {
      data: {},
      savedAt: new Date().toISOString(),
      baseUpdatedAt: "2024-01-01T00:00:00.000Z",
    };
    expect(draftHasConflict(draft, "2024-02-01T00:00:00.000Z")).toBe(true);
  });

  it("er usann når baseUpdatedAt og serverUpdatedAt er like", () => {
    const draft: RecipeDraftPayload<unknown> = {
      data: {},
      savedAt: new Date().toISOString(),
      baseUpdatedAt: "2024-01-01T00:00:00.000Z",
    };
    expect(draftHasConflict(draft, "2024-01-01T00:00:00.000Z")).toBe(false);
  });

  it("er usann når baseUpdatedAt eller serverUpdatedAt mangler", () => {
    const draft: RecipeDraftPayload<unknown> = {
      data: {},
      savedAt: new Date().toISOString(),
      baseUpdatedAt: null,
    };
    expect(draftHasConflict(draft, "2024-01-01T00:00:00.000Z")).toBe(false);
    expect(draftHasConflict(null, "2024-01-01T00:00:00.000Z")).toBe(false);
  });
});
