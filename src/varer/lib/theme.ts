/**
 * Konverterer en hex-farge (#rrggbb) til HSL-komponenter for CSS-variabler.
 * Returnerer streng på formatet "H S% L%" som passer rett inn i `hsl(var(--x))`.
 */
function hexToHslTriplet(hex: string): { h: number; s: number; l: number } {
  const cleaned = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    throw new Error(`Ugyldig hex: ${hex}`);
  }
  const r = parseInt(cleaned.slice(0, 2), 16) / 255;
  const g = parseInt(cleaned.slice(2, 4), 16) / 255;
  const b = parseInt(cleaned.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h = h * 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function tripletToCssVar({ h, s, l }: { h: number; s: number; l: number }) {
  return `${h} ${s}% ${l}%`;
}

/** Setter --app-primary og varianter på <html> basert på app-fargen fra apps-tabellen. */
export function setAppThemeFromHex(hex: string) {
  try {
    const base = hexToHslTriplet(hex);
    const dark = { ...base, l: Math.max(12, base.l - 8) };
    const light = { ...base, l: Math.min(80, base.l + 18), s: Math.max(40, base.s - 10) };
    const pastel = { ...base, l: Math.min(96, base.l + 55), s: Math.max(35, base.s - 20) };
    const root = document.documentElement;
    root.style.setProperty("--app-primary", tripletToCssVar(base));
    root.style.setProperty("--app-primary-dark", tripletToCssVar(dark));
    root.style.setProperty("--app-primary-light", tripletToCssVar(light));
    root.style.setProperty("--app-primary-pastel", tripletToCssVar(pastel));
    root.style.setProperty("--app-primary-foreground", base.l > 60 ? "222 47% 11%" : "0 0% 100%");
  } catch (e) {
    console.warn("setAppThemeFromHex failed:", e);
  }
}
