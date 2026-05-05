import type { ProfileField } from "../types";

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Inner content area of label = paper minus margins (in mm). */
export function getInnerArea(
  paperWmm: number,
  paperHmm: number,
  marginTop: number,
  marginRight: number,
  marginBottom: number,
  marginLeft: number,
  landscape: boolean,
): { w: number; h: number } {
  const w = (landscape ? paperWmm : paperHmm) - marginLeft - marginRight;
  const h = (landscape ? paperHmm : paperWmm) - marginTop - marginBottom;
  return { w: Math.max(10, w), h: Math.max(10, h) };
}

export interface PaperPreset {
  id: string;
  label: string;
  width_mm: number;
  height_mm: number;
}

export const PAPER_PRESETS: PaperPreset[] = [
  { id: "100x75", label: "100 × 75 mm", width_mm: 100, height_mm: 75 },
  { id: "100x50", label: "100 × 50 mm", width_mm: 100, height_mm: 50 },
  { id: "100x100", label: "100 × 100 mm", width_mm: 100, height_mm: 100 },
  { id: "a6", label: "A6 (105 × 148 mm)", width_mm: 105, height_mm: 148 },
  { id: "a7", label: "A7 (74 × 105 mm)", width_mm: 74, height_mm: 105 },
  { id: "dymo89", label: "Dymo 89 × 36 mm", width_mm: 89, height_mm: 36 },
  { id: "dymo57", label: "Dymo 57 × 32 mm", width_mm: 57, height_mm: 32 },
];

export function matchPreset(w: number, h: number): string {
  const found = PAPER_PRESETS.find(
    (p) => p.width_mm === w && p.height_mm === h,
  );
  return found?.id ?? "custom";
}

/**
 * Migrate legacy row-based layout to canvas (x/y/width/height) coordinates.
 * Idempotent: if any included field has width_mm > 0 and y_mm > 0 set, treats as already migrated.
 */
export function migrateLegacyFields(
  fields: ProfileField[],
  innerWidthMm: number,
  innerHeightMm: number,
): ProfileField[] {
  const included = fields.filter((f) => f.include);
  // Already migrated heuristic: at least one included field has non-zero width_mm AND any non-zero y_mm
  const hasCanvasData = included.some(
    (f) => f.width_mm > 0 && (f.y_mm > 0 || f.x_mm > 0),
  );
  if (hasCanvasData) {
    // Ensure all fields have valid width/height/y/x even when migrated
    return fields.map((f) => ({
      ...f,
      x_mm: typeof f.x_mm === "number" ? f.x_mm : 0,
      y_mm: typeof f.y_mm === "number" ? f.y_mm : 0,
      width_mm: f.width_mm > 0 ? f.width_mm : 40,
      height_mm: f.height_mm > 0 ? f.height_mm : 6,
      z_index: typeof f.z_index === "number" ? f.z_index : 0,
    }));
  }

  // Group included by row_number ascending
  const byRow = new Map<number, ProfileField[]>();
  for (const f of included) {
    const r = f.row_number || 1;
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r)!.push(f);
  }
  const sortedRows = [...byRow.keys()].sort((a, b) => a - b);

  const updated = new Map<string, Partial<ProfileField>>();
  let cursorY = 0;
  const lineH = 6; // mm per row

  for (const r of sortedRows) {
    const rowFields = byRow.get(r)!;
    let cursorX = 0;
    let rowMaxH = lineH;
    for (const f of rowFields) {
      const fracW = widthFractionToMm(f.width_fraction, innerWidthMm);
      const h = lineH * (f.row_count && f.row_count > 0 ? f.row_count : 1);
      const w = Math.min(fracW, innerWidthMm - cursorX);
      const yOffset = f.print_at_bottom
        ? Math.max(0, innerHeightMm - h - 2)
        : cursorY;
      updated.set(f.field_type, {
        x_mm: round1(cursorX + (f.margin_left_mm ?? 0)),
        y_mm: round1(yOffset + (f.margin_top_mm ?? 0)),
        width_mm: round1(w),
        height_mm: round1(h),
      });
      cursorX += w;
      if (h > rowMaxH) rowMaxH = h;
    }
    cursorY += rowMaxH;
  }

  return fields.map((f, idx) => ({
    ...f,
    z_index: typeof f.z_index === "number" ? f.z_index : idx,
    ...(updated.get(f.field_type) ?? {
      x_mm: typeof f.x_mm === "number" ? f.x_mm : 0,
      y_mm: typeof f.y_mm === "number" ? f.y_mm : 0,
      width_mm: f.width_mm > 0 ? f.width_mm : 40,
      height_mm: f.height_mm > 0 ? f.height_mm : 6,
    }),
  }));
}

function widthFractionToMm(frac: string, innerWmm: number): number {
  switch (frac) {
    case "3/4":
      return innerWmm * 0.75;
    case "2/3":
      return innerWmm * (2 / 3);
    case "1/2":
      return innerWmm * 0.5;
    case "1/3":
      return innerWmm * (1 / 3);
    case "1/4":
      return innerWmm * 0.25;
    default:
      return innerWmm;
  }
}

/** Snap value to nearest snap step. */
export function snap(v: number, step: number): number {
  return Math.round(v / step) * step;
}
