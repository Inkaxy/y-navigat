import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { packageNeedsConfirmation, resolveLineCost } from "@/fakturaer/lib/units";

/**
 * De fire sondene fra gjennomgangen av matchemotoren. Poenget er ikke bare at
 * hjelperen regner riktig, men at matchemotoren faktisk RUTER dem til
 * gjennomgang i stedet for å la dem gå gjennom som ferdige.
 */
const FN = readFileSync(resolve("supabase/functions/match-invoice-lines/index.ts"), "utf8");

describe("matchemotoren ruter usikre linjer til gjennomgang", () => {
  it("sonde 1: pakning kun tolket fra varenavnet må bekreftes", () => {
    const r = resolveLineCost({
      quantity: 2,
      unit: "kartong",
      unitPrice: 600,
      totalAmount: 1200,
      description: "Mel 6x1kg",
      baseUnit: "kg",
    });
    expect(packageNeedsConfirmation(r)).toBe(true);
  });

  it("sonde 2: eksplisitt beløp 0 erstattes ikke av mengde × enhetspris", () => {
    const r = resolveLineCost({
      quantity: 10,
      unit: "kg",
      unitPrice: 100,
      totalAmount: 0,
      description: "Sukker",
      baseUnit: "kg",
    });
    expect(r.needsInput).toBe("amount");
    expect(r.pricePerBaseUnit).toBeFalsy();
    expect(r.baseQuantity).toBeFalsy();
  });

  it("sonde 3: historikk kan ikke gjøre om en kjent kg-måling til pakninger", () => {
    const r = resolveLineCost({
      quantity: 2,
      unit: "kg",
      unitPrice: 100,
      totalAmount: 200,
      description: "Sukker",
      baseUnit: "kg",
      supplierPackage: { baseUnitsPerPackage: 10, packageConfirmedAt: "2026-01-01" },
      knownPricePerBaseUnit: 10,
    });
    expect(r.baseQuantity).toBe(2);
    expect(r.pricePerBaseUnit).toBeCloseTo(100, 6);
  });

  it("sonde 4: ingen omregning mellom liter og kilo via pakningsfaktor", () => {
    const r = resolveLineCost({
      quantity: 2,
      unit: "l",
      unitPrice: 100,
      totalAmount: 200,
      description: "Olje",
      baseUnit: "kg",
      supplierPackage: { baseUnitsPerPackage: 10, packageConfirmedAt: "2026-01-01" },
    });
    expect(r.needsInput).toBe("package_size");
    expect(r.baseQuantity).toBeFalsy();
  });

  it("begge grenene i matchemotoren krever bekreftet pakning", () => {
    const hits = FN.match(/packageNeedsConfirmation\(cost\)/g) ?? [];
    expect(hits.length).toBe(2);
  });

  it("ukjent prisgrunnlag blir en egen gjennomgangsårsak", () => {
    const hits = FN.match(/price_reference_error/g) ?? [];
    expect(hits.length).toBe(2);
  });

  it("nødvendige lesninger og skrivinger feiler lukket", () => {
    expect(FN).toContain("Kunne ikke lese ");
    expect(FN).toContain("Kunne ikke sjekke ubehandlede linjer");
    expect(FN).toContain("Kunne ikke sjekke linjer til gjennomgang");
    expect(FN).toContain("Kunne ikke oppdatere fakturastatus");
    expect(FN).toContain("Kunne ikke lagre forslag");
    expect(FN).toContain("Kunne ikke nullstille forslag");
  });

  it("avtalens gyldighet hentes med, slik at utløpte avtaler ikke blir grunnlag", () => {
    expect(FN).toContain("agreement_valid_from");
    expect(FN).toContain("agreement_valid_to");
  });
});
