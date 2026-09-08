import { describe, it, expect } from "vitest";
import { calcWaterTemp, type WaterTempInput } from "@/varer/lib/bakers";

const base: WaterTempInput = {
  targetDoughTempC: 24,
  roomTempC: 21,
  flourTempC: 20,
  frictionC: 2,
};

describe("calcWaterTemp — vektet deigtemperatur", () => {
  it("gir kjent fasit uten fordeig", () => {
    // 3 × 24 − (21 + 20 + 2) = 72 − 43 = 29
    const res = calcWaterTemp(base);
    expect(res).not.toBeNull();
    expect(res?.waterTempC).toBe(29);
    expect(res?.prefermentSharePct).toBe(0);
  });

  it("en fordeig på 10 % flytter vanntemperaturen mindre enn en på 50 %", () => {
    const uten = calcWaterTemp(base)!.waterTempC;

    const med10 = calcWaterTemp({
      ...base,
      preferment: { tempC: 4, grams: 100 },
      totalDoughG: 1000,
    })!.waterTempC;

    const med50 = calcWaterTemp({
      ...base,
      preferment: { tempC: 4, grams: 500 },
      totalDoughG: 1000,
    })!.waterTempC;

    const avvik10 = Math.abs(med10 - uten);
    const avvik50 = Math.abs(med50 - uten);
    expect(avvik10).toBeLessThan(avvik50);
  });

  it("regner prefermentSharePct riktig", () => {
    const res = calcWaterTemp({
      ...base,
      preferment: { tempC: 4, grams: 250 },
      totalDoughG: 1000,
    });
    expect(res?.prefermentSharePct).toBe(25);
  });

  it("returnerer null når nødvendige tall mangler", () => {
    expect(calcWaterTemp({ ...base, targetDoughTempC: NaN })).toBeNull();
    expect(
      calcWaterTemp({
        ...base,
        preferment: { tempC: 4, grams: 100 },
        // totalDoughG mangler
      }),
    ).toBeNull();
  });

  it("returnerer null når tallene ikke er endelige", () => {
    expect(
      calcWaterTemp({ ...base, roomTempC: Number.POSITIVE_INFINITY }),
    ).toBeNull();
  });

  it("klemmer fordeigens andel til 0–1", () => {
    // Fordeigen er «tyngre» enn hele deigen — andelen skal klemmes til 1 (100 %).
    const res = calcWaterTemp({
      ...base,
      preferment: { tempC: 4, grams: 1500 },
      totalDoughG: 1000,
    });
    expect(res?.prefermentSharePct).toBe(100);
  });
});
