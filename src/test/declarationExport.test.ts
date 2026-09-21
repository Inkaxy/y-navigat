import { describe, it, expect } from "vitest";
import {
  checkApiKey,
  exportRejection,
  isApprovedForExport,
} from "../../supabase/functions/_shared/declaration-export";

describe("exportRejection", () => {
  const approved = {
    ingredientText: "Hvetemel, vann, salt",
    needsReview: false,
    calculated: { computed_at: "2026-09-01T10:00:00Z", is_stale: false },
  };

  it("slipper gjennom godkjent merking", () => {
    expect(exportRejection(approved)).toBeNull();
    expect(isApprovedForExport(approved)).toBe(true);
  });

  it("holder tilbake vare uten deklarasjon", () => {
    expect(exportRejection({ ...approved, ingredientText: "   " })).toBe("mangler_deklarasjon");
  });

  it("holder tilbake vare som krever ny gjennomgang", () => {
    expect(exportRejection({ ...approved, needsReview: true })).toBe("krever_ny_gjennomgang");
  });

  it("holder tilbake utdatert beregning", () => {
    expect(exportRejection({ ...approved, calculated: { computed_at: "2026-09-01T10:00:00Z", is_stale: true } })).toBe(
      "utdatert",
    );
  });

  it("holder tilbake koblet vare uten beregning", () => {
    expect(exportRejection({ ...approved, calculated: { computed_at: null, is_stale: null } })).toBe("utdatert");
  });

  it("godtar vare uten oppskriftskobling når deklarasjonen er godkjent", () => {
    expect(exportRejection({ ...approved, calculated: null })).toBeNull();
  });
});

describe("checkApiKey", () => {
  const row = { id: "k1", legal_entity_id: "e1", revoked_at: null, scopes: ["declarations"] };

  it("avviser ukjent nøkkel", () => {
    expect(checkApiKey(null)).toEqual({ ok: false, code: "unauthorized" });
  });

  it("avviser tilbakekalt nøkkel", () => {
    expect(checkApiKey({ ...row, revoked_at: "2026-09-01T00:00:00Z" })).toEqual({ ok: false, code: "revoked" });
  });

  it("avviser nøkkel uten riktig rettighet", () => {
    expect(checkApiKey({ ...row, scopes: ["pakkesystem"] })).toEqual({ ok: false, code: "forbidden_scope" });
  });

  it("godtar gyldig nøkkel", () => {
    expect(checkApiKey(row)).toEqual({ ok: true, keyId: "k1", legalEntityId: "e1" });
  });
});
