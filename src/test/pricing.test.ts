import { describe, it, expect } from "vitest";
import { roundPrice, applyAdjustment, formatKr, toCsv } from "@/varer/lib/pricing";

describe("roundPrice", () => {
  it("avrunder til 2 desimaler når steg er 0", () => {
    expect(roundPrice(12.3456, 0)).toBe(12.35);
    expect(roundPrice(12.344, 0)).toBe(12.34);
  });

  it("avrunder til nærmeste halve krone", () => {
    expect(roundPrice(12.2, 0.5)).toBe(12);
    expect(roundPrice(12.3, 0.5)).toBe(12.5);
    expect(roundPrice(12.75, 0.5)).toBe(13);
  });

  it("avrunder til hele kroner", () => {
    expect(roundPrice(12.49, 1)).toBe(12);
    expect(roundPrice(12.5, 1)).toBe(13);
  });

  it("avrunder til nærmeste 5 og 10", () => {
    expect(roundPrice(12.4, 5)).toBe(10);
    expect(roundPrice(13, 5)).toBe(15);
    expect(roundPrice(14, 10)).toBe(10);
    expect(roundPrice(15, 10)).toBe(20);
  });
});

describe("applyAdjustment", () => {
  it("øker med prosent", () => {
    expect(applyAdjustment(100, "increase_pct", 10, 0)).toBe(110);
    expect(applyAdjustment(19.9, "increase_pct", 5, 0)).toBe(20.9);
  });

  it("senker med prosent", () => {
    expect(applyAdjustment(100, "decrease_pct", 25, 0)).toBe(75);
  });

  it("setter fast pris uavhengig av nåværende", () => {
    expect(applyAdjustment(null, "set", 49.9, 0)).toBe(49.9);
    expect(applyAdjustment(10, "set", 49.9, 1)).toBe(50);
  });

  it("returnerer null ved prosentjustering uten utgangspris", () => {
    expect(applyAdjustment(null, "increase_pct", 10, 0)).toBeNull();
    expect(applyAdjustment(null, "decrease_pct", 10, 0)).toBeNull();
  });

  it("bruker avrundingssteget på resultatet", () => {
    expect(applyAdjustment(100, "increase_pct", 7, 5)).toBe(105);
    expect(applyAdjustment(100, "increase_pct", 7, 0.5)).toBe(107);
  });
});

describe("formatKr", () => {
  it("formaterer med to desimaler og komma", () => {
    expect(formatKr(1234.5)).toBe("1234,50");
    expect(formatKr(0)).toBe("0,00");
  });

  it("viser tankestrek for tomme verdier", () => {
    expect(formatKr(null)).toBe("—");
    expect(formatKr(undefined)).toBe("—");
  });
});

describe("toCsv", () => {
  it("skriver rader med semikolon og håndterer tomme celler", () => {
    const csv = toCsv([
      ["Vare", "Pris"],
      ["Rundstykke", 12.5],
      ["Uten pris", null],
    ]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Vare");
    expect(lines[1]).toContain("Rundstykke");
  });
});
