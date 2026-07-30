import { describe, it, expect } from "vitest";
import { osloDateISO, osloTodayISO, osloDateISOPlusDays } from "@/lib/osloDate";

describe("osloDateISO", () => {
  it("gir norsk dato, ikke UTC-dato, tidlig om natta (sommertid)", () => {
    // 2026-06-15T00:30Z = 02:30 norsk tid samme dag
    expect(osloDateISO("2026-06-15T00:30:00Z")).toBe("2026-06-15");
    // 2026-06-15T22:30Z = 00:30 norsk tid NESTE dag
    expect(osloDateISO("2026-06-15T22:30:00Z")).toBe("2026-06-16");
  });

  it("håndterer vintertid (UTC+1)", () => {
    expect(osloDateISO("2026-01-15T23:30:00Z")).toBe("2026-01-16");
    expect(osloDateISO("2026-01-15T22:30:00Z")).toBe("2026-01-15");
  });

  it("returnerer tom streng for ugyldig dato", () => {
    expect(osloDateISO("ikke-en-dato")).toBe("");
  });

  it("aksepterer Date og timestamp", () => {
    const d = new Date("2026-03-01T12:00:00Z");
    expect(osloDateISO(d)).toBe("2026-03-01");
    expect(osloDateISO(d.getTime())).toBe("2026-03-01");
  });
});

describe("osloTodayISO", () => {
  it("gir formatet YYYY-MM-DD", () => {
    expect(osloTodayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("osloDateISOPlusDays", () => {
  it("legger til og trekker fra dager", () => {
    const from = new Date("2026-06-15T10:00:00Z");
    expect(osloDateISOPlusDays(1, from)).toBe("2026-06-16");
    expect(osloDateISOPlusDays(-1, from)).toBe("2026-06-14");
    expect(osloDateISOPlusDays(0, from)).toBe("2026-06-15");
  });

  it("krysser månedsskifte riktig", () => {
    expect(osloDateISOPlusDays(1, new Date("2026-01-31T10:00:00Z"))).toBe("2026-02-01");
  });
});
