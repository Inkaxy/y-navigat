import { describe, it, expect } from "vitest";
import { buildPaymentSummary, roundCash, verifyAgainstTotal } from "@/kiosk/lib/payment";

describe("roundCash", () => {
  it("avrunder til nærmeste hele krone", () => {
    expect(roundCash(12.4)).toBe(12);
    expect(roundCash(12.5)).toBe(13);
    expect(roundCash(12.49)).toBe(12);
  });
});

describe("buildPaymentSummary", () => {
  it("kort: total_paid = totalIncl og ingen avrunding", () => {
    const s = buildPaymentSummary({ method: "card", totalIncl: 137.4, cardBrand: "VISA" });
    expect(s.total_paid).toBeCloseTo(137.4, 6);
    expect(s.rounding).toBe(0);
    expect(s.change_given).toBe(0);
    expect(s.payments[0].card_brand).toBe("VISA");
  });

  it("legger ikke kortmerke på ikke-kort-betaling", () => {
    const s = buildPaymentSummary({ method: "vipps", totalIncl: 50, cardBrand: "VISA", reference: "V-1" });
    expect(s.payments[0].card_brand).toBeUndefined();
    expect(s.payments[0].reference).toBe("V-1");
  });

  it("kontant: runder opp og setter positiv avrunding", () => {
    const s = buildPaymentSummary({ method: "cash", totalIncl: 137.6, cashReceived: 200 });
    expect(s.total_paid).toBe(138);
    expect(s.rounding).toBeCloseTo(0.4, 6);
    expect(s.change_given).toBeCloseTo(62, 6);
  });

  it("kontant: runder ned og setter negativ avrunding", () => {
    const s = buildPaymentSummary({ method: "cash", totalIncl: 137.4, cashReceived: 140 });
    expect(s.total_paid).toBe(137);
    expect(s.rounding).toBeCloseTo(-0.4, 6);
    expect(s.change_given).toBeCloseTo(3, 6);
  });

  it("kontant uten oppgitt mottatt beløp gir ingen vekslepenger", () => {
    const s = buildPaymentSummary({ method: "cash", totalIncl: 99.5 });
    expect(s.total_paid).toBe(100);
    expect(s.change_given).toBe(0);
  });

  it("gir aldri negative vekslepenger", () => {
    const s = buildPaymentSummary({ method: "cash", totalIncl: 100, cashReceived: 50 });
    expect(s.change_given).toBe(0);
  });

  it("holder RPC-invarianten total_paid - rounding === totalIncl", () => {
    for (const total of [0, 1.01, 12.34, 99.99, 137.6, 1000.5]) {
      const s = buildPaymentSummary({ method: "cash", totalIncl: total, cashReceived: 2000 });
      expect(Math.abs(s.total_paid - s.rounding - total)).toBeLessThanOrEqual(0.01);
    }
  });
});

describe("verifyAgainstTotal", () => {
  it("passerer når summen stemmer", () => {
    const s = buildPaymentSummary({ method: "cash", totalIncl: 137.6, cashReceived: 200 });
    expect(() => verifyAgainstTotal(s, 137.6)).not.toThrow();
  });

  it("kaster når summen avviker", () => {
    const s = buildPaymentSummary({ method: "card", totalIncl: 100 });
    expect(() => verifyAgainstTotal(s, 105)).toThrow(/Payment mismatch/);
  });
});
