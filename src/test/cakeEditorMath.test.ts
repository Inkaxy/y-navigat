import { describe, expect, it } from "vitest";
import {
  curvedTextArc,
  dpiLevel,
  exportScaleFor,
  fillScale,
  fitScale,
  fitZoom,
  layerDpi,
  pxPerMm,
  removeColorDistance,
  snapAngle,
} from "@/ordre/lib/cakeEditorMath";

describe("pxPerMm og layerDpi", () => {
  it("regner arbeidspiksler per millimeter", () => {
    expect(pxPerMm(2362, 200)).toBeCloseTo(11.81, 2);
    expect(pxPerMm(0, 200)).toBe(0);
  });

  it("gir 300 DPI når kilden dekker den fysiske bredden nøyaktig", () => {
    // 200 mm ved 300 DPI = 2362 px. Laget dekker hele bredden.
    const dpi = layerDpi({ sourcePx: 2362, renderedPx: 2362, pxPerMm: pxPerMm(2362, 200) });
    expect(dpi).toBe(300);
  });

  it("halverer DPI når laget forstørres til dobbel bredde", () => {
    const ppm = pxPerMm(2362, 200);
    expect(layerDpi({ sourcePx: 2362, renderedPx: 4724, pxPerMm: ppm })).toBe(150);
  });

  it("mangler måling uten kildepiksler", () => {
    expect(layerDpi({ sourcePx: 0, renderedPx: 100, pxPerMm: 10 })).toBeNull();
  });

  it("gir nivå etter grensene 150 og 300", () => {
    expect(dpiLevel(320)).toBe("god");
    expect(dpiLevel(200)).toBe("middels");
    expect(dpiLevel(120)).toBe("lav");
    expect(dpiLevel(null)).toBe("lav");
  });
});

describe("fyll og tilpass", () => {
  it("tilpass velger minste skalering, fyll velger største", () => {
    expect(fitScale(1000, 500, 800, 800)).toBeCloseTo(0.8);
    expect(fillScale(1000, 500, 800, 800)).toBeCloseTo(1.6);
  });

  it("fyll dekker alltid hele formatet", () => {
    const s = fillScale(400, 1200, 900, 600);
    expect(400 * s).toBeGreaterThanOrEqual(900 - 0.001);
    expect(1200 * s).toBeGreaterThanOrEqual(600 - 0.001);
  });

  it("tilpass-zoom holder seg innenfor visningen", () => {
    const z = fitZoom(2362, 2362, 800, 600, 32);
    expect(2362 * z).toBeLessThanOrEqual(600);
  });

  it("eksportmultiplikator løfter arbeidslerretet til måloppløsningen", () => {
    expect(exportScaleFor(1181, 2362)).toBe(2);
  });
});

describe("rotasjon og terskel", () => {
  it("snapper til 90 grader når vi er nær nok", () => {
    expect(snapAngle(88)).toBe(90);
    expect(snapAngle(1.5)).toBe(0);
    expect(snapAngle(45)).toBe(45);
  });

  it("gjør terskelprosent om til Fabric-avstand 0–1", () => {
    expect(removeColorDistance(0)).toBe(0);
    expect(removeColorDistance(20)).toBe(0.2);
    expect(removeColorDistance(400)).toBe(1);
  });
});

describe("buet tekst", () => {
  it("buevinkelen er tekstbredden delt på radien", () => {
    const arc = curvedTextArc(500, 250, "up");
    expect(arc.theta).toBeCloseTo(0.5, 5);
  });

  it("buer oppover med senter under teksten", () => {
    const arc = curvedTextArc(400, 200, "up");
    expect(arc.start.y).toBeLessThan(0);
    expect(arc.start.x).toBeLessThan(0);
    expect(arc.end.x).toBeGreaterThan(0);
    expect(arc.sweep).toBe(1);
    expect(arc.d.startsWith("M ")).toBe(true);
  });

  it("buer nedover med motsatt retning", () => {
    const arc = curvedTextArc(400, 200, "down");
    expect(arc.start.y).toBeGreaterThan(0);
    expect(arc.sweep).toBe(0);
  });

  it("stor bue markeres med large-arc-flagget", () => {
    const arc = curvedTextArc(100, 400, "up");
    expect(arc.largeArc).toBe(1);
  });
});
