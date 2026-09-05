import { describe, expect, it } from "vitest";
import {
  CREDIT_OVERRIDE_NOTE_PREFIX,
  evaluateCustomerContext,
  isValidCreditOverrideReason,
  withCreditOverrideNote,
} from "@/ordre/lib/customerContext";

describe("kundekontekst — kredittstopp", () => {
  it("blokkerer lagring uten overstyring", () => {
    const res = evaluateCustomerContext({
      creditHold: true,
      creditHoldReason: "Forfalt faktura",
      canOverrideCreditHold: true,
    });
    expect(res.blocked).toBe(true);
    expect(res.blockMessage).toContain("Forfalt faktura");
  });

  it("blokkerer når begrunnelsen er for kort", () => {
    const res = evaluateCustomerContext({
      creditHold: true,
      creditOverrideReason: "kort",
      canOverrideCreditHold: true,
    });
    expect(res.blocked).toBe(true);
  });

  it("tillater lagring med gyldig begrunnelse", () => {
    const res = evaluateCustomerContext({
      creditHold: true,
      creditOverrideReason: "Avtalt med daglig leder i dag",
      canOverrideCreditHold: true,
    });
    expect(res.blocked).toBe(false);
    expect(res.warnings.some((w) => w.startsWith("Kredittstopp er overstyrt"))).toBe(true);
  });

  it("blokkerer alltid uten skriverettigheter", () => {
    const res = evaluateCustomerContext({
      creditHold: true,
      creditOverrideReason: "Avtalt med daglig leder i dag",
      canOverrideCreditHold: false,
    });
    expect(res.blocked).toBe(true);
  });

  it("krever minst ti tegn i begrunnelsen", () => {
    expect(isValidCreditOverrideReason("   ")).toBe(false);
    expect(isValidCreditOverrideReason("Avtalt med sjefen")).toBe(true);
  });
});

describe("kundekontekst — advarsler", () => {
  it("advarer ved leveransepause uten å blokkere", () => {
    const res = evaluateCustomerContext({
      creditHold: false,
      pause: { reason: "Ferie", notes: null },
    });
    expect(res.blocked).toBe(false);
    expect(res.warnings.join(" ")).toContain("Ferie");
  });

  it("advarer ved kunde som ikke er aktiv", () => {
    const res = evaluateCustomerContext({ creditHold: false, status: "inactive" });
    expect(res.blocked).toBe(false);
    expect(res.warnings.join(" ")).toContain("Inaktiv");
  });

  it("gir ingen advarsler for en aktiv kunde uten pause", () => {
    const res = evaluateCustomerContext({ creditHold: false, status: "active" });
    expect(res).toEqual({ blocked: false, blockMessage: null, warnings: [] });
  });
});

describe("internt notat ved overstyring", () => {
  it("legger begrunnelsen øverst og beholder eksisterende tekst", () => {
    const out = withCreditOverrideNote("Husk kake til kl. 08", "Avtalt med daglig leder");
    expect(out.startsWith(`${CREDIT_OVERRIDE_NOTE_PREFIX} Avtalt med daglig leder`)).toBe(true);
    expect(out).toContain("Husk kake til kl. 08");
  });

  it("erstatter tidligere begrunnelse", () => {
    const first = withCreditOverrideNote("", "Første begrunnelse");
    const second = withCreditOverrideNote(first, "Andre begrunnelse");
    expect(second).toBe(`${CREDIT_OVERRIDE_NOTE_PREFIX} Andre begrunnelse`);
  });
});
