import { describe, it, expect } from "vitest";
import { classifyAnonResult, classifyAnonDeniedOnly } from "./support/anonAccess";

/** Offline-tester av feilklassifiseringen som RLS-testene bygger på. */
describe("classifyAnonResult", () => {
  it("godtar permission denied 42501 med 403", () => {
    expect(
      classifyAnonResult({ data: null, error: { code: "42501", message: "permission denied" }, status: 403 }),
    ).toEqual({ kind: "denied", code: "42501", status: 403 });
  });

  it("godtar dokumentert autentiseringsavvisning PGRST301 med 401", () => {
    expect(
      classifyAnonResult({ data: null, error: { code: "PGRST301", message: "JWT" }, status: 401 }),
    ).toEqual({ kind: "denied", code: "PGRST301", status: 401 });
  });

  it("godtar ekte tomt array", () => {
    expect(classifyAnonResult({ data: [], error: null, status: 200 })).toEqual({ kind: "empty" });
  });

  it("avviser rader ut til anon", () => {
    expect(classifyAnonResult({ data: [{ id: 1 }], error: null, status: 200 }).kind).toBe("violation");
  });

  it("avviser null som suksess", () => {
    expect(classifyAnonResult({ data: null, error: null, status: 200 }).kind).toBe("violation");
  });

  it("avviser objekt som suksess", () => {
    expect(classifyAnonResult({ data: { id: 1 }, error: null, status: 200 }).kind).toBe("violation");
  });

  it("avviser nettverksfeil uten kode og status", () => {
    expect(
      classifyAnonResult({ data: null, error: { message: "TypeError: fetch failed" }, status: null }).kind,
    ).toBe("violation");
  });

  for (const status of [400, 404, 500] as const) {
    it(`avviser HTTP ${status}`, () => {
      expect(
        classifyAnonResult({ data: null, error: { code: "PGRST202", message: "feil" }, status }).kind,
      ).toBe("violation");
    });
  }

  it("avviser skjemafeil (ukjent relasjon)", () => {
    expect(
      classifyAnonResult({
        data: null,
        error: { code: "42P01", message: 'relation "orders" does not exist' },
        status: 404,
      }).kind,
    ).toBe("violation");
  });

  it("avviser riktig kode med feil status", () => {
    expect(
      classifyAnonResult({ data: null, error: { code: "42501", message: "denied" }, status: 500 }).kind,
    ).toBe("violation");
  });
});

describe("classifyAnonDeniedOnly", () => {
  it("krever eksplisitt avvisning — tomt array er ikke nok", () => {
    expect(classifyAnonDeniedOnly({ data: [], error: null, status: 200 }).kind).toBe("violation");
  });

  it("godtar permission denied", () => {
    expect(
      classifyAnonDeniedOnly({ data: null, error: { code: "42501", message: "denied" }, status: 403 }).kind,
    ).toBe("denied");
  });
});
