import { describe, it, expect } from "vitest";
import { normalizeSupplierName } from "@/ravarer/lib/supplierName";
import { getAgreementStatus, countExpiringSoon } from "@/ravarer/lib/agreementStatus";
import {
  offerPricePerBaseUnit,
  bestOfferRecipient,
  targetPctForItem,
  negotiationStatusLabel,
  isNegotiationClosed,
} from "@/ravarer/lib/negotiationMatrix";

describe("normalizeSupplierName", () => {
  it("fjerner selskapsform og tegnsetting", () => {
    expect(normalizeSupplierName("Bakeriservice AS")).toBe("bakeriservice");
    expect(normalizeSupplierName("Bakeriservice A/S")).toBe("bakeriservice");
    expect(normalizeSupplierName("  BAKERISERVICE,  as ")).toBe("bakeriservice");
  });

  it("regner varianter av samme navn som like", () => {
    expect(normalizeSupplierName("Norsk Mølle ASA")).toBe(normalizeSupplierName("norsk mølle"));
  });

  it("beholder navn som ikke er selskapsform", () => {
    expect(normalizeSupplierName("Asbjørn Mel")).toBe("asbjørn mel");
  });

  it("tåler tomt navn", () => {
    expect(normalizeSupplierName(null)).toBe("");
  });
});

describe("getAgreementStatus", () => {
  const today = "2026-09-08";

  it("avtale som starter senere er kommende", () => {
    expect(getAgreementStatus("2026-10-01", "2027-01-01", today)).toBe("upcoming");
  });

  it("løpende avtale uten sluttdato er aktiv", () => {
    expect(getAgreementStatus("2026-01-01", null, today)).toBe("active");
  });

  it("utløpt avtale", () => {
    expect(getAgreementStatus("2025-01-01", "2026-09-07", today)).toBe("expired");
  });

  it("30 og 90 dager", () => {
    expect(getAgreementStatus("2026-01-01", "2026-09-20", today)).toBe("expiring_30");
    expect(getAgreementStatus("2026-01-01", "2026-11-01", today)).toBe("expiring_90");
    expect(getAgreementStatus("2026-01-01", "2027-06-01", today)).toBe("active");
  });

  it("teller avtaler som utløper innen 30 dager", () => {
    const rows = [
      { agreement_valid_from: "2026-01-01", agreement_valid_to: "2026-09-20" },
      { agreement_valid_from: "2026-01-01", agreement_valid_to: "2026-11-01" },
      { agreement_valid_from: "2026-10-01", agreement_valid_to: "2026-10-05" },
    ];
    expect(countExpiringSoon(rows, today)).toBe(1);
  });
});

describe("offerPricePerBaseUnit", () => {
  it("pris per sekk regnes om via pakningsstørrelse i kg", () => {
    const r = offerPricePerBaseUnit({ offeredPrice: 250, offeredPackageSize: 25, offeredPackageUnit: "kg", baseUnit: "kg" });
    expect(r.value).toBeCloseTo(10);
  });

  it("gram regnes om til kilo", () => {
    const r = offerPricePerBaseUnit({ offeredPrice: 90, offeredPackageSize: 900, offeredPackageUnit: "g", baseUnit: "kg" });
    expect(r.value).toBeCloseTo(100);
  });

  it("uten pakning regnes prisen som per grunnenhet", () => {
    const r = offerPricePerBaseUnit({ offeredPrice: 12.5, baseUnit: "kg" });
    expect(r.value).toBe(12.5);
  });

  it("emballasjeenhet bruker koblingens antall grunnenheter", () => {
    const r = offerPricePerBaseUnit({
      offeredPrice: 400,
      offeredPackageSize: 1,
      offeredPackageUnit: "sekk",
      baseUnit: "kg",
      linkBaseUnitsPerPackage: 20,
    });
    expect(r.value).toBeCloseTo(20);
  });

  it("ukjent pakningsenhet uten kobling gir ingen pris", () => {
    const r = offerPricePerBaseUnit({ offeredPrice: 400, offeredPackageSize: 1, offeredPackageUnit: "sekk", baseUnit: "kg" });
    expect(r.value).toBeNull();
    expect(r.reason).toBe("Ukjent pakningsenhet");
  });

  it("beste tilbud er laveste pris per grunnenhet", () => {
    expect(
      bestOfferRecipient([
        { recipientId: "a", pricePerBaseUnit: 12 },
        { recipientId: "b", pricePerBaseUnit: 9.5 },
        { recipientId: "c", pricePerBaseUnit: null },
      ]),
    ).toBe("b");
    expect(bestOfferRecipient([{ recipientId: "a", pricePerBaseUnit: null }])).toBeNull();
  });
});

describe("mål og etiketter", () => {
  it("målprosent utledes av målpris mot baseline", () => {
    expect(targetPctForItem({ targetPrice: 9, baselinePrice: 10 })).toBeCloseTo(10);
  });

  it("uten målpris brukes standarden", () => {
    expect(targetPctForItem({ targetPrice: null, baselinePrice: 10 })).toBe(5);
  });

  it("norske statusetiketter", () => {
    expect(negotiationStatusLabel("in_progress")).toBe("Pågår");
    expect(isNegotiationClosed("concluded")).toBe(true);
    expect(isNegotiationClosed("invited")).toBe(false);
  });
});
