import { describe, expect, it } from "vitest";
import {
  fitsOnSheet,
  packSheets,
  sheetSize,
  SHEET_SIZES,
  type PackItem,
} from "@/ordre/lib/cakeSheetLayout";
import { sheetFit, type CakeImageFormat } from "@/ordre/lib/cakeFormats";

const item = (id: string, w: number, h: number, extra: Partial<PackItem> = {}): PackItem => ({
  id,
  widthMm: w,
  heightMm: h,
  ...extra,
});

const format = (o: Partial<CakeImageFormat>): CakeImageFormat => ({
  id: "f",
  legal_entity_id: "le",
  name: "Format",
  shape: "rect",
  width_mm: 100,
  height_mm: 100,
  diameter_mm: null,
  bleed_mm: 0,
  sheet: "A4",
  is_default: false,
  is_active: true,
  sort_order: 0,
  ...o,
});

describe("cakeSheetLayout", () => {
  it("legger fire Ø150-bilder på ett A4-ark", () => {
    const items = [1, 2, 3, 4].map((n) => item(`r${n}`, 150, 150, { isRound: true }));
    const res = packSheets(items, { sheet: "A4", marginMm: 8, gapMm: 4 });
    expect(res.unplaceable).toHaveLength(0);
    expect(res.pages).toHaveLength(4);
  });

  it("pakker fire små bilder på samme ark", () => {
    const items = [1, 2, 3, 4].map((n) => item(`s${n}`, 90, 90));
    const res = packSheets(items, { sheet: "A4", marginMm: 8, gapMm: 8 });
    expect(res.pages).toHaveLength(1);
    expect(res.pages[0].placements).toHaveLength(4);
  });

  it("roterer bildet når det bare får plass på tvers", () => {
    const res = packSheets([item("wide", 270, 100)], {
      sheet: "A4",
      marginMm: 8,
    });
    expect(res.unplaceable).toHaveLength(0);
    expect(res.pages[0].placements[0].rotated).toBe(true);
  });

  it("regner med utfall (bleed) når plassen vurderes", () => {
    const size = sheetSize("A4", "portrait");
    expect(fitsOnSheet(item("a", 190, 280), size, 8).fits).toBe(true);
    expect(fitsOnSheet(item("b", 190, 280, { bleedMm: 5 }), size, 8).fits).toBe(false);
  });

  it("respekterer reservert bunnbånd", () => {
    const size = sheetSize("A4", "portrait");
    expect(fitsOnSheet(item("c", 150, 275), size, 8, 22).fits).toBe(false);
  });

  it("A3 er større enn A4 og liggende bytter kantene", () => {
    expect(SHEET_SIZES.A3.widthMm).toBe(297);
    expect(sheetSize("A4", "landscape")).toEqual({ widthMm: 297, heightMm: 210 });
  });

  it("bilder uten mål blir liggende igjen som uplasserbare", () => {
    const res = packSheets([item("x", 0, 0)], { sheet: "A4" });
    expect(res.unplaceable.map((u) => u.id)).toEqual(["x"]);
  });
});

describe("sheetFit", () => {
  it("godtar et A4-format som får plass stående", () => {
    const fit = sheetFit(format({ width_mm: 180, height_mm: 250 }));
    expect(fit.fits).toBe(true);
    expect(fit.orientation).toBe("portrait");
  });

  it("velger liggende når bildet er bredere enn arket er høyt smalt", () => {
    const fit = sheetFit(format({ width_mm: 280, height_mm: 190 }));
    expect(fit.fits).toBe(true);
    expect(fit.orientation).toBe("landscape");
  });

  it("foreslår A3 når bildet ikke får plass på A4", () => {
    const fit = sheetFit(format({ shape: "round", diameter_mm: 280, width_mm: null, height_mm: null }));
    expect(fit.fits).toBe(false);
    expect(fit.suggestion?.sheet).toBe("A3");
    expect(fit.message).toBeTruthy();
  });

  it("godtar et A3-format på A3", () => {
    const fit = sheetFit(format({ sheet: "A3", width_mm: 280, height_mm: 400 }));
    expect(fit.fits).toBe(true);
    expect(fit.sheet?.widthMm).toBe(297);
  });
});
