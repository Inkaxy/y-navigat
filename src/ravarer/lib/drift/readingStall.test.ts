import { describe, expect, it } from "vitest";
import { errorType, errorsByType, readingStall } from "./readingStall";

const now = Date.parse("2026-11-18T12:00:00Z");
const h = (n: number) => new Date(now - n * 3_600_000).toISOString();

describe("varsel: lesingen står stille eller feiler", () => {
  it("stillstand: fakturaer venter og siste lesing er 24 timer eller eldre", () => {
    expect(readingStall({ lastOkAt: h(24), pending: 3, attempts24h: 0, failed24h: 0 }, now)).toEqual({ kind: "stillstand", hours: 24 });
    expect(readingStall({ lastOkAt: h(23), pending: 3, attempts24h: 0, failed24h: 0 }, now).kind).toBe("ok");
    expect(readingStall({ lastOkAt: h(48), pending: 0, attempts24h: 0, failed24h: 0 }, now).kind).toBe("ok"); // ingenting å lese
    expect(readingStall({ lastOkAt: null, pending: 1, attempts24h: 0, failed24h: 0 }, now)).toEqual({ kind: "stillstand", hours: null });
  });
  it("feilrate: minst 5 lesinger siste døgn og minst 30 % feilet", () => {
    expect(readingStall({ lastOkAt: h(1), pending: 0, attempts24h: 10, failed24h: 3 }, now)).toEqual({ kind: "feilrate", pct: 30 });
    expect(readingStall({ lastOkAt: h(1), pending: 0, attempts24h: 10, failed24h: 2 }, now).kind).toBe("ok");
    expect(readingStall({ lastOkAt: h(1), pending: 0, attempts24h: 4, failed24h: 4 }, now).kind).toBe("ok");
  });
  it("ukjente tall gir aldri «ok»", () => {
    expect(readingStall({ lastOkAt: h(1), pending: null, attempts24h: 10, failed24h: 0 }, now).kind).toBe("ukjent");
  });
  it("feiltyper telles", () => {
    expect(errorType("AI-tjenesten: 401 invalid_api_key")).toBe("AI-nøkkel avvist");
    expect(errorType(null)).toBe("ukjent");
    expect(errorsByType([{ line_extraction_error: "429 rate limit" }, { line_extraction_error: "quota" }, { line_extraction_error: "Timeout" }]))
      .toEqual([{ type: "Kvote/for mange kall", count: 2 }, { type: "Tidsavbrudd", count: 1 }]);
  });
});
