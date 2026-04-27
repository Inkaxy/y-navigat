/** Color helpers — convert hex to HSL parts ("H S% L%") for CSS variables. */

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace("#", "").trim();
  const full =
    cleaned.length === 3
      ? cleaned.split("").map((c) => c + c).join("")
      : cleaned;
  if (full.length !== 6) return { r: 14, g: 165, b: 233 }; // fallback NBHub sky
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      case bn: h = (rn - gn) / d + 4; break;
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hexToHslParts(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

export function hslString(h: number, s: number, l: number) {
  return `${h} ${s}% ${l}%`;
}

/** Mix a hex color with black (factor 0..1, where 1 = pure black). */
export function mixWithBlack(hex: string, factor: number): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  const f = clamp(factor, 0, 1);
  const r2 = Math.round(r * (1 - f));
  const g2 = Math.round(g * (1 - f));
  const b2 = Math.round(b * (1 - f));
  return rgbToHsl(r2, g2, b2);
}

export function readableForeground(l: number): string {
  return l > 60 ? "32 28% 13%" : "45 60% 95%";
}

/* ============================================================================
   Legacy palette — beholdt for kompatibilitet med eldre AppThemeProvider.
   Nytt shell bruker --app-color via AppColorProvider.
   ========================================================================== */
export interface AppPalette {
  primary: string;
  primaryForeground: string;
  primaryDark: string;
  primaryLight: string;
  primaryPastel: string;
  primaryPastelBorder: string;
}

export function buildAppPalette(hex: string | null | undefined): AppPalette {
  const { h, s, l } = hexToHslParts(hex || "#0EA5E9");
  return {
    primary: hslString(h, s, l),
    primaryForeground: readableForeground(l),
    primaryDark: hslString(h, s, clamp(l - 15, 5, 95)),
    primaryLight: hslString(h, s, clamp(l + 6, 5, 95)),
    primaryPastel: hslString(h, clamp(s, 20, 95), 95),
    primaryPastelBorder: hslString(h, clamp(s - 30, 10, 90), 85),
  };
}
