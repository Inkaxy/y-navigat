import { describe, expect, it } from "vitest";
import { placementGeometry, rotatedImageDraw } from "@/ordre/lib/cakePrint";
import { packSheets } from "@/ordre/lib/cakeSheetLayout";
import type { Placement } from "@/ordre/lib/cakeSheetLayout";

const CAPTION_MM = 12;

describe("placementGeometry", () => {
  it("trekker etikettstripa fra høyden på en urotert plassering", () => {
    const place: Placement = {
      id: "a",
      xMm: 10,
      yMm: 20,
      widthMm: 150,
      heightMm: 100 + CAPTION_MM,
      bleedMm: 0,
      rotated: false,
    };
    const geo = placementGeometry(place);
    expect(geo).toMatchObject({ xMm: 10, yMm: 20, widthMm: 150, heightMm: 100 });
    expect(geo.captionYMm).toBe(122);
  });

  it("bytter mål og flytter etikettstripa til siden når plasseringen er rotert", () => {
    // Bildet er 200 × 100 mm; pakkeren la det på tvers.
    const packed = packSheets(
      [{ id: "wide", widthMm: 200, heightMm: 100 + CAPTION_MM }],
      { sheet: "A4", marginMm: 8 },
    );
    const place = packed.pages[0].placements[0];
    expect(place.rotated).toBe(true);

    const geo = placementGeometry(place);
    expect(geo.widthMm).toBe(100); // opprinnelig høyde
    expect(geo.heightMm).toBe(200); // opprinnelig bredde
    expect(geo.captionXMm).toBe(geo.xMm + 100 + 2);
  });
});

describe("rotatedImageDraw", () => {
  it("gir jsPDF-argumenter som treffer nøyaktig ønsket boks", () => {
    const draw = rotatedImageDraw(20, 30, 100, 200);
    // jsPDF roterer 90° rundt nedre venstre hjørne av den uroterte boksen.
    const left = draw.xMm - draw.heightMm;
    const top = draw.yMm + draw.heightMm - draw.widthMm;
    expect(left).toBe(20);
    expect(top).toBe(30);
    expect(draw.heightMm).toBe(100); // bredden på papiret
    expect(draw.widthMm).toBe(200); // høyden på papiret
    expect(draw.rotation).toBe(90);
  });
});
