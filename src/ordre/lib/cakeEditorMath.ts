/**
 * Ren matematikk for kakebilde-editoren. Ingen Fabric, ingen DOM — slik at
 * reglene kan testes og gjenbrukes uten et lerret.
 */

export const MM_PER_INCH = 25.4;

/** Hvor mange arbeids-piksler utgjør én millimeter i det gjeldende formatet. */
export function pxPerMm(canvasWidthPx: number, widthMm: number): number {
  if (!canvasWidthPx || !widthMm) return 0;
  return canvasWidthPx / widthMm;
}

/**
 * Faktisk DPI for et bildelag: kildepikslene fordelt på den fysiske bredden
 * laget dekker på kaken etter skalering.
 */
export function layerDpi(args: {
  sourcePx: number;
  renderedPx: number;
  pxPerMm: number;
}): number | null {
  const { sourcePx, renderedPx, pxPerMm: ppm } = args;
  if (!sourcePx || !renderedPx || !ppm) return null;
  const mm = renderedPx / ppm;
  if (mm <= 0) return null;
  return Math.round(sourcePx / (mm / MM_PER_INCH));
}

export type DpiLevel = "lav" | "middels" | "god";

export function dpiLevel(dpi: number | null | undefined): DpiLevel {
  if (dpi == null || !Number.isFinite(dpi)) return "lav";
  if (dpi >= 300) return "god";
  if (dpi >= 150) return "middels";
  return "lav";
}

/** Skalering som får hele bildet innenfor formatet (kan gi luft i kantene). */
export function fitScale(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
): number {
  if (!imgW || !imgH) return 1;
  return Math.min(boxW / imgW, boxH / imgH);
}

/** Skalering som fyller hele formatet (bildet beskjæres i én retning). */
export function fillScale(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
): number {
  if (!imgW || !imgH) return 1;
  return Math.max(boxW / imgW, boxH / imgH);
}

/** Zoom som får hele lerretet inn i visningsområdet, med litt luft. */
export function fitZoom(
  contentW: number,
  contentH: number,
  viewW: number,
  viewH: number,
  padding = 32,
): number {
  if (!contentW || !contentH || viewW <= 0 || viewH <= 0) return 1;
  const z = Math.min(
    (viewW - padding) / contentW,
    (viewH - padding) / contentH,
  );
  return Math.max(0.02, Math.min(4, z));
}

/** Multiplikator for eksport: hvor mange ganger arbeidslerretet må forstørres. */
export function exportScaleFor(
  workCanvasWidthPx: number,
  targetWidthPx: number,
): number {
  if (!workCanvasWidthPx || !targetWidthPx) return 1;
  return targetWidthPx / workCanvasWidthPx;
}

/** Rund av til nærmeste 90° når vi er nær nok — ellers behold fri vinkel. */
export function snapAngle(angle: number, tolerance = 4): number {
  const wrapped = ((angle + 180) % 360 + 360) % 360 - 180;
  for (const step of [-180, -90, 0, 90, 180]) {
    if (Math.abs(wrapped - step) <= tolerance) return step;
  }
  return Math.round(wrapped);
}

/** «Fjern hvit bakgrunn»: terskel i prosent → Fabric-avstand 0–1. */
export function removeColorDistance(thresholdPct: number): number {
  const pct = Math.max(0, Math.min(100, thresholdPct));
  return Math.round((pct / 100) * 100) / 100;
}

export type CurvedArc = {
  /** Buens vinkel i radianer. */
  theta: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
  largeArc: 0 | 1;
  sweep: 0 | 1;
  d: string;
};

/**
 * Bue for buet tekst. `direction: "up"` gir tekst som buer oppover
 * (senter under teksten), `"down"` buer nedover.
 */
export function curvedTextArc(
  radius: number,
  textWidth: number,
  direction: "up" | "down" = "up",
): CurvedArc {
  const r = Math.max(1, radius);
  const theta = Math.min((textWidth || 0) / r, Math.PI * 1.8);
  const half = theta / 2;
  const sx = -r * Math.sin(half);
  const sy = direction === "up" ? -r * Math.cos(half) : r * Math.cos(half);
  const ex = r * Math.sin(half);
  const ey = sy;
  const largeArc: 0 | 1 = theta > Math.PI ? 1 : 0;
  const sweep: 0 | 1 = direction === "up" ? 1 : 0;
  const n = (v: number) => Math.round(v * 100) / 100;
  return {
    theta,
    start: { x: sx, y: sy },
    end: { x: ex, y: ey },
    largeArc,
    sweep,
    d: `M ${n(sx)} ${n(sy)} A ${n(r)} ${n(r)} 0 ${largeArc} ${sweep} ${n(ex)} ${n(ey)}`,
  };
}
