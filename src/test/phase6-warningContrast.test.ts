import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/index.css", "utf8");

type Rgb = [number, number, number];
function token(name: string, dark = false): string {
  const re = new RegExp(`--${name}:\\s*([^;]+);`);
  const darkBlock = css.slice(css.indexOf(".dark {"), css.indexOf("}", css.indexOf(".dark {")));
  // Mørkt tema arver :root-verdien når .dark ikke overstyrer (CSS-kaskade).
  const m = (dark ? darkBlock.match(re) : null) ?? css.match(re);
  if (!m) throw new Error(`mangler --${name}`);
  const v = m[1].trim();
  const ref = v.match(/^var\(--([\w-]+)\)$/);
  return ref ? token(ref[1], dark) : v;
}
function hsl(v: string): Rgb {
  const [h, s, l] = v.split(/\s+/).map((x) => parseFloat(x));
  const S = s / 100, L = l / 100, a = S * Math.min(L, 1 - L);
  const f = (n: number) => { const k = (n + h / 30) % 12; return 255 * (L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return [f(0), f(8), f(4)];
}
const mix = (fg: Rgb, bg: Rgb, a: number): Rgb => [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)) as Rgb;
function lum([r, g, b]: Rgb) {
  const c = (x: number) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
const ratio = (a: Rgb, b: Rgb) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("Råvarer varseltekst – kontrastkontrakt", () => {
  it("har scoped tekstregel og semantisk blekk for lyst/mørkt tema", () => {
    expect(css).toMatch(/html\[data-active-app="ravarer"\] \{[^}]*--rm-warning-ink: var\(--brand-bronze-deep\)/);
    expect(css).toMatch(/html\.dark\[data-active-app="ravarer"\] \{[^}]*--rm-warning-ink: 30 62% 66%;/);
    expect(css).toMatch(/html\[data-active-app="ravarer"\] \.text-warning,\s*html\[data-active-app="ravarer"\] \.hover\\:text-warning:hover \{\s*color: hsl\(var\(--rm-warning-ink\)\);/);
    // --warning (bakgrunn/ramme) er uendret og ikke globalt overstyrt.
    expect(css).toMatch(/--warning:\s+var\(--state-warning\);/);
    expect(css).not.toMatch(/^\s*\.text-warning\s*\{/m);
  });

  it.each([false, true])("varselblekk ≥4,5:1 på /10, /15 og flater (mørkt=%s)", (dark) => {
    const ink = hsl(dark ? "30 62% 66%" : token("brand-bronze-deep"));
    const warn = hsl(token("state-warning", dark));
    const surfaces = ["surface-canvas", "surface-raised", "surface-sunken", "surface-muted"].map((n) => hsl(token(n, dark)));
    const backgrounds: Rgb[] = [...surfaces, ...surfaces.flatMap((s) => [mix(warn, s, 0.1), mix(warn, s, 0.15)])];
    if (!dark) backgrounds.push([238, 227, 212], [243, 227, 205]); // målt valgt rad og målt merke-bakgrunn
    for (const bg of backgrounds) expect(ratio(ink, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
