/**
 * Fysisk størrelse styrer alt i kakebilder. Lerretet regnes ut fra millimeter
 * ved 300 DPI — aldri omvendt. En kake på 20 cm skal bli 20 cm på sukkerpapiret.
 */

export const CAKE_DPI = 300;

/** Ark vi trykker på. Deles med nestingen. */
import {
  SHEET_SIZES,
  sheetSize,
  DEFAULT_MARGIN_MM,
  type SheetOrientation,
} from "@/ordre/lib/cakeSheetLayout";

export { SHEET_SIZES as SHEETS, sheetSize };
export type { SheetOrientation };



export type CakeImageFormat = {
  id: string;
  legal_entity_id: string;
  name: string;
  shape: "rect" | "round";
  width_mm: number | null;
  height_mm: number | null;
  diameter_mm: number | null;
  bleed_mm: number;
  sheet: string;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
};

export function mmToPx(mm: number, dpi = CAKE_DPI) {
  return Math.round((mm / 25.4) * dpi);
}

export function pxToMm(px: number, dpi = CAKE_DPI) {
  return (px / dpi) * 25.4;
}

export type FormatDims = {
  widthMm: number;
  heightMm: number;
  isRound: boolean;
  bleedMm: number;
  widthPx: number;
  heightPx: number;
  bleedPx: number;
};

export function formatDims(f: CakeImageFormat): FormatDims {
  const isRound = f.shape === "round";
  const widthMm = isRound ? (f.diameter_mm ?? 0) : (f.width_mm ?? 0);
  const heightMm = isRound ? (f.diameter_mm ?? 0) : (f.height_mm ?? 0);
  const bleedMm = f.bleed_mm ?? 0;
  return {
    widthMm,
    heightMm,
    isRound,
    bleedMm,
    widthPx: mmToPx(widthMm),
    heightPx: mmToPx(heightMm),
    bleedPx: mmToPx(bleedMm),
  };
}

/** «Rund 20 cm · 200 mm · 2362 × 2362 px» */
export function formatSizeLabel(f: CakeImageFormat) {
  const d = formatDims(f);
  const mm = d.isRound
    ? `${Math.round(d.widthMm)} mm`
    : `${Math.round(d.widthMm)} × ${Math.round(d.heightMm)} mm`;
  return `${f.name} · ${mm} · ${d.widthPx} × ${d.heightPx} px`;
}

/**
 * Passer formatet på arket det er satt opp med? Vi regner med utfall og
 * trykkmarg, og prøver både stående og liggende. Får bildet ikke plass,
 * foreslår vi et ark og en retning som faktisk holder.
 */
export function sheetFit(f: CakeImageFormat): {
  fits: boolean;
  sheet: { widthMm: number; heightMm: number } | null;
  orientation: SheetOrientation;
  suggestion: { sheet: string; orientation: SheetOrientation } | null;
  message: string | null;
} {
  const base = SHEET_SIZES[f.sheet] ?? null;
  const d = formatDims(f);
  const total = { w: d.widthMm + 2 * d.bleedMm, h: d.heightMm + 2 * d.bleedMm };
  const m = 2 * DEFAULT_MARGIN_MM;

  const tryFit = (name: string, orientation: SheetOrientation) => {
    const s = sheetSize(name, orientation);
    return total.w <= s.widthMm - m && total.h <= s.heightMm - m;
  };

  const candidates: Array<{ sheet: string; orientation: SheetOrientation }> = [
    { sheet: f.sheet, orientation: "portrait" },
    { sheet: f.sheet, orientation: "landscape" },
    { sheet: "A3", orientation: "portrait" },
    { sheet: "A3", orientation: "landscape" },
  ];

  if (!base) {
    return {
      fits: false,
      sheet: null,
      orientation: "portrait",
      suggestion: null,
      message: `Formatet «${f.name}» har et ukjent ark (${f.sheet}). Velg A4 eller A3.`,
    };
  }

  for (const c of candidates.slice(0, 2)) {
    if (tryFit(c.sheet, c.orientation)) {
      return {
        fits: true,
        sheet: sheetSize(c.sheet, c.orientation),
        orientation: c.orientation,
        suggestion: null,
        message: null,
      };
    }
  }

  const better = candidates.find((c) => tryFit(c.sheet, c.orientation)) ?? null;
  return {
    fits: false,
    sheet: base,
    orientation: "portrait",
    suggestion: better,
    message:
      `${f.name} (${Math.round(total.w)} × ${Math.round(total.h)} mm med utfall) får ikke plass på ${f.sheet} ` +
      (better
        ? `stående. Bruk ${better.sheet} ${better.orientation === "landscape" ? "liggende" : "stående"}.`
        : `— heller ikke på A3. Bildet kan ikke trykkes i riktig størrelse.`),
  };
}


export type QualityFlag = "god" | "akseptabel" | "lav" | "ukjent";

/**
 * effective_dpi = source_px / (mm / 25.4), målt på korteste kant mot
 * tilsvarende fysiske mål.
 */
export function computeEffectiveDpi(
  sourceWidthPx: number | null | undefined,
  sourceHeightPx: number | null | undefined,
  f: CakeImageFormat | null | undefined,
): number | null {
  if (!f || !sourceWidthPx || !sourceHeightPx) return null;
  const d = formatDims(f);
  if (!d.widthMm || !d.heightMm) return null;
  const dpiW = sourceWidthPx / (d.widthMm / 25.4);
  const dpiH = sourceHeightPx / (d.heightMm / 25.4);
  return Math.round(Math.min(dpiW, dpiH));
}

export function qualityFlagFor(dpi: number | null | undefined): QualityFlag {
  if (dpi == null || !Number.isFinite(dpi)) return "ukjent";
  if (dpi >= 300) return "god";
  if (dpi >= 150) return "akseptabel";
  return "lav";
}

/** Rolig setning, ikke en teknisk verdi. */
export function qualityMessage(
  dpi: number | null | undefined,
  f: CakeImageFormat | null | undefined,
): string {
  if (dpi == null || !f) return "Oppløsningen er ikke målt for dette bildet ennå.";
  const size = formatDims(f).isRound
    ? `${Math.round(formatDims(f).widthMm / 10)} cm`
    : f.name.toLowerCase();
  switch (qualityFlagFor(dpi)) {
    case "god":
      return `Dette bildet blir ${dpi} DPI på ${size} — skarpt nok for spiselig print.`;
    case "akseptabel":
      return `Dette bildet blir ${dpi} DPI på ${size} — det går, men det blir litt mykt i kantene. En større fil ville gitt et bedre resultat.`;
    default:
      return `Dette bildet blir ${dpi} DPI på ${size} — det vil se synlig uskarpt ut. Be kunden om en større fil hvis mulig.`;
  }
}

/**
 * Hvor mange ganger må lerretet forstørres ved eksport for å lande på minst
 * 300 DPI? Lerretet kan være mindre enn den fysiske størrelsen tilsier (f.eks.
 * hvis det er begrenset av nettleseren), og da må eksporten kompensere —
 * ellers får trykkeriet et uskarpt bilde.
 */
export function exportMultiplier(
  canvasWidthPx: number,
  widthMm: number,
  dpi = CAKE_DPI,
): number {
  if (!canvasWidthPx || !widthMm) return 1;
  const needed = mmToPx(widthMm, dpi);
  const m = needed / canvasWidthPx;
  if (!Number.isFinite(m) || m <= 1) return 1;
  return Math.min(8, Math.ceil(m * 100) / 100);
}
