import { describe, expect, it } from "vitest";
import { buildAllergenEvidence, type RawMaterialRef } from "@/varer/lib/declarationEvidence";
import { substantiateFindings } from "@/varer/lib/declarationProposal";

const materials = new Map<string, RawMaterialRef>([
  ["rm-gjennomgatt", { name: "Hvetemel", reviewed: true }],
  ["rm-ikke-gjennomgatt", { name: "Kryddermiks", reviewed: false }],
]);

describe("hvilke råvaredata kan gjøre et funn bekreftet", () => {
  it("gjennomgått råvare med «contains» kan underbygge bekreftet funn", () => {
    const e = buildAllergenEvidence(
      [{ raw_material_id: "rm-gjennomgatt", allergen: "gluten_wheat", presence: "contains" }],
      materials,
    );
    expect(e.verified.map((v) => v.code)).toEqual(["gluten_wheat"]);
    expect(e.unconfirmedCount).toBe(0);
    expect(e.registeredContains).toEqual(["gluten_wheat"]);
  });

  it("ikke gjennomgått råvare kan ikke underbygge bekreftet funn", () => {
    const e = buildAllergenEvidence(
      [{ raw_material_id: "rm-ikke-gjennomgatt", allergen: "mustard", presence: "contains" }],
      materials,
    );
    expect(e.verified).toHaveLength(0);
    expect(e.unconfirmedCount).toBe(1);
    expect(e.context[0]).toContain("IKKE gjennomgått");
    expect(e.context[0]).toContain("kan IKKE underbygge bekreftet funn");
    // Rada er fortsatt registrert som «contains» og brukes til avvikskontroll.
    expect(e.registeredContains).toEqual(["mustard"]);
  });

  it("«kan inneholde» kan ikke underbygge bekreftet funn, selv om råvaren er gjennomgått", () => {
    const e = buildAllergenEvidence(
      [{ raw_material_id: "rm-gjennomgatt", allergen: "nuts", presence: "may_contain" }],
      materials,
    );
    expect(e.verified).toHaveLength(0);
    expect(e.unconfirmedCount).toBe(1);
    expect(e.registeredContains).toHaveLength(0);
  });

  it("manglende gjennomgang er ingen konklusjon om at allergenet mangler", () => {
    const e = buildAllergenEvidence(
      [{ raw_material_id: "rm-ikke-gjennomgatt", allergen: "soy", presence: "free_from" }],
      materials,
    );
    expect(e.context[0]).toContain("free_from");
    expect(e.context[0]).toContain("IKKE gjennomgått");
    expect(e.verified).toHaveLength(0);
  });

  it("ukjent råvare-id gir kontekst, ikke bevis", () => {
    const e = buildAllergenEvidence(
      [{ raw_material_id: "ukjent", allergen: "milk", presence: "contains" }],
      materials,
    );
    expect(e.verified).toHaveLength(0);
    expect(e.unconfirmedCount).toBe(1);
  });
});

describe("funn nedgraderes når beviset ikke holder", () => {
  const finding = { code: "gluten_wheat", basis: "verified" as const, evidence: "Hvetemel", severity: "critical" as const };

  it("bekreftet funn står når en gjennomgått contains-rad finnes", () => {
    const e = buildAllergenEvidence(
      [{ raw_material_id: "rm-gjennomgatt", allergen: "gluten_wheat", presence: "contains" }],
      materials,
    );
    const out = substantiateFindings([finding], e.verified);
    expect(out[0].basis).toBe("verified");
  });

  it("bekreftet funn nedgraderes når bare ikke gjennomgåtte data finnes", () => {
    const e = buildAllergenEvidence(
      [{ raw_material_id: "rm-ikke-gjennomgatt", allergen: "gluten_wheat", presence: "contains" }],
      materials,
    );
    const out = substantiateFindings([finding], e.verified);
    expect(out[0].basis).not.toBe("verified");
  });

  it("bekreftet funn nedgraderes når bare «kan inneholde» finnes", () => {
    const e = buildAllergenEvidence(
      [{ raw_material_id: "rm-gjennomgatt", allergen: "gluten_wheat", presence: "may_contain" }],
      materials,
    );
    const out = substantiateFindings([finding], e.verified);
    expect(out[0].basis).not.toBe("verified");
  });
});
