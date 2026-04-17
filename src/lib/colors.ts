/** Color helpers — convert hex to HSL parts ("H S% L%") for CSS variables. */

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function hexToHslParts(hex: string): { h: number; s: number; l: number } {
  const cleaned = hex.replace("#", "").trim();
  const full = cleaned.length === 3
    ? cleaned.split("").map((c) => c + c).join("")
    : cleaned;
  if (full.length !== 6) return { h: 199, s: 89, l: 48 };
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function hslString(h: number, s: number, l: number) {
  return `${h} ${s}% ${l}%`;
}

/** Pick readable foreground (white/dark slate) for a given lightness. */
export function readableForeground(l: number): string {
  return l > 60 ? "222 47% 11%" : "0 0% 100%";
}

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
