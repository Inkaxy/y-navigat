import { describe, it, expect } from "vitest";
import {
  chooseAgreedPrice,
  kpiDeviation,
  perBaseUnitFromPackage,
  pricePerPackage,
} from "@/ravarer/lib/rawMaterialKpi";
import {
  buildTimeline,
  timelineCsv,
  MANUAL_KEY,
} from "@/ravarer/lib/priceTimeline";

describe("rawMaterialKpi", () => {
  it("regner pris per pakning", () => {
    expect(pricePerPackage(12.5, 25)).toBe(312.5);
    expect(pricePerPackage(12.5, 0)).toBeNull();
    expect(pricePerPackage(null, 25)).toBeNull();
  });

  it("regner pakningspris om til pris per grunnenhet", () => {
    expect(perBaseUnitFromPackage(300, 25)).toBe(12);
    expect(perBaseUnitFromPackage(300, null)).toBeNull();
  });

  it("velger avtalepris fra primærkoblingen før råvarens fallback", () => {
    const fromLink = chooseAgreedPrice({
      linkPricePerBaseUnit: 11,
      linkValidFrom: "2026-01-01",
      linkValidTo: null,
      rawMaterialAgreedPrice: 9,
    });
    expect(fromLink).toMatchObject({
      value: 11,
      source: "link",
      validFrom: "2026-01-01",
    });

    expect(chooseAgreedPrice({ rawMaterialAgreedPrice: 9 })).toMatchObject({
      value: 9,
      source: "raw_material",
    });
    expect(chooseAgreedPrice({})).toMatchObject({
      value: null,
      source: "none",
    });
  });

  it("måler avvik mot avtale, ellers kostpris", () => {
    expect(kpiDeviation(11, 10, 8)).toEqual({ pct: 10, basis: "avtale" });
    expect(kpiDeviation(12, null, 10)).toEqual({ pct: 20, basis: "kostpris" });
    expect(kpiDeviation(12, null, null)).toEqual({ pct: null, basis: null });
    expect(kpiDeviation(null, 10, 10)).toEqual({ pct: null, basis: null });
  });
});

describe("priceTimeline", () => {
  const history = [
    {
      id: "1",
      effective_date: "2026-01-10",
      price: 10,
      supplier_id: "s1",
      source: "invoice",
      invoice_id: "i1",
      invoiceNumber: "F-1",
      isCreditNote: false,
      notes: null,
    },
    {
      id: "2",
      effective_date: "2026-02-10",
      price: 12,
      supplier_id: null,
      source: "manual",
      invoice_id: null,
      invoiceNumber: null,
      isCreditNote: false,
      notes: null,
    },
    {
      id: "3",
      effective_date: "2026-02-20",
      price: -3,
      supplier_id: "s1",
      source: "invoice",
      invoice_id: "i2",
      invoiceNumber: "K-1",
      isCreditNote: true,
      notes: null,
    },
  ];

  it("bygger serier per leverandør og manuelle priser", () => {
    const result = buildTimeline({
      history,
      supplierNames: new Map([["s1", "Leverandør 1"]]),
      links: [],
    });
    const keys = result.series.map((s) => s.key);
    expect(keys).toContain("s1");
    expect(keys).toContain(MANUAL_KEY);
  });

  it("merker kreditnotaer", () => {
    const result = buildTimeline({
      history,
      supplierNames: new Map([["s1", "Leverandør 1"]]),
      links: [],
    });
    const supplier = result.series.find((x) => x.key === "s1");
    expect(supplier?.points).toHaveLength(2);
    expect(supplier?.points.filter((p) => p.isCreditNote)).toHaveLength(1);
  });

  it("regner om til pris per pakning", () => {
    const result = buildTimeline({
      history: [history[0]],
      supplierNames: new Map([["s1", "Leverandør 1"]]),
      links: [],
      unitFactor: 25,
    });
    expect(result.series[0].points[0].price).toBe(250);
  });

  it("lager avtalebånd fra koblingene", () => {
    const result = buildTimeline({
      history,
      supplierNames: new Map([["s1", "Leverandør 1"]]),
      links: [
        {
          supplier_id: "s1",
          agreed_price_per_base_unit: 9.5,
          agreement_valid_from: "2026-01-01",
          agreement_valid_to: "2026-03-01",
        },
      ],
    });
    expect(result.bands).toHaveLength(1);
    expect(result.bands[0].price).toBe(9.5);
  });

  it("eksporterer csv med semikolon", () => {
    const result = buildTimeline({
      history,
      supplierNames: new Map([["s1", "Leverandør 1"]]),
      links: [],
    });
    const csv = timelineCsv(result.rows);
    expect(csv.split("\n")[0]).toContain(";");
  });
});
