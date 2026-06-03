/**
 * Estimer skriftstørrelse (i pt eller px — samme enhet inn = samme enhet ut)
 * som får `text` til å passe innenfor (widthMm × heightMm) med ordbryting.
 *
 * Bruker en enkel heuristikk: gjennomsnittlig tegnbredde ≈ 0.55 × fontSize,
 * linjehøyde ≈ 1.15 × fontSize. Konvertering pt → mm = pt / 2.83465.
 *
 * Returnerer en størrelse mellom `minSize` og `baseSize`. Hvis teksten passer
 * ved `baseSize` returneres `baseSize` uendret.
 */
export function fitFontSizePt(
  text: string,
  baseSizePt: number,
  widthMm: number,
  heightMm: number,
  opts?: { minPt?: number; bold?: boolean; padMm?: number },
): number {
  const minPt = opts?.minPt ?? 5;
  const padMm = opts?.padMm ?? 0.6;
  const w = Math.max(1, widthMm - padMm);
  const h = Math.max(1, heightMm - padMm);
  if (!text) return baseSizePt;
  const charFactor = (opts?.bold ? 0.58 : 0.55);
  const PT_TO_MM = 1 / 2.83465;

  const fits = (size: number): boolean => {
    const charWmm = size * charFactor * PT_TO_MM;
    const lineHmm = size * 1.15 * PT_TO_MM;
    if (lineHmm > h) return false;
    const charsPerLine = Math.max(1, Math.floor(w / charWmm));
    const linesAvail = Math.max(1, Math.floor(h / lineHmm));
    const lines = countWrappedLines(text, charsPerLine);
    return lines <= linesAvail;
  };

  if (fits(baseSizePt)) return baseSizePt;
  // Binary search ned mot minPt
  let lo = minPt;
  let hi = baseSizePt;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.max(minPt, Math.floor(lo * 10) / 10);
}

function countWrappedLines(text: string, charsPerLine: number): number {
  const paragraphs = text.split(/\n/);
  let total = 0;
  for (const p of paragraphs) {
    if (!p) {
      total += 1;
      continue;
    }
    const words = p.split(/\s+/);
    let curLen = 0;
    let lines = 1;
    for (const w of words) {
      if (w.length > charsPerLine) {
        // ord lengre enn linjen — antallet linjer det opptar
        if (curLen > 0) lines += 1;
        lines += Math.ceil(w.length / charsPerLine) - 1;
        curLen = w.length % charsPerLine || charsPerLine;
      } else if (curLen === 0) {
        curLen = w.length;
      } else if (curLen + 1 + w.length <= charsPerLine) {
        curLen += 1 + w.length;
      } else {
        lines += 1;
        curLen = w.length;
      }
    }
    total += lines;
  }
  return Math.max(1, total);
}
