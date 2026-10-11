// Lesekontroll for fakturalinjer — delt mellom nettleseren og edge-funksjoner.
// Filen må være byte-identisk med supabase/functions/_shared/invoiceReadCheck.ts
// (test vokter dette) og fri for Deno- og nettleser-spesifikke API-er.
// Regnereglene speiler databasefunksjonen public.rm_line_read_issues.

export type ReadIssueCode =
  | "linjesum_mangler" | "ugyldig_tall" | "mengde_null" | "mulig_rabatt" | "regnestykke"
  | "sumavvik_mva_forhold" | "tomt_resultat";

export interface ReadIssue { code: ReadIssueCode | string; message: string }

/**
 * Norske tall: «1 234,50», «1.234,50», «1 234», «-12,5», «12,5 kr». Engelsk
 * «1,234.50» godtas også. Returnerer null for alt som ikke er et endelig tall.
 */
export function parseNorwegianNumber(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  let s = input.replace(/[\s\u00a0\u202f]/g, "").replace(/(kr|nok|,-)$/i, "").replace(/^(kr|nok)/i, "");
  if (s === "" || !/^[-+]?[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Det siste skilletegnet er desimaltegnet.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = (s.match(/,/g) ?? []).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length > 1 || /^\d{1,3}(\.\d{3})+$/.test(s.replace(/^[-+]/, ""))) {
    // «1.234.567» eller «1.234» (tusenskille) — norsk tusenskille med punktum.
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Sikkerhet fra modellen begrenses til 0–1; alt annet blir null (ukjent). */
export function clampConfidence(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseNorwegianNumber(v) : null;
  if (n == null || !Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

/** Samlet sikkerhet: laveste av header-snittet og linjenes sikkerhet — header alene frikjenner aldri linjer. */
export function overallConfidence(headerValues: readonly unknown[], lineValues: readonly unknown[]): number | null {
  const h = headerValues.map(clampConfidence).filter((x): x is number => x != null);
  const l = lineValues.map(clampConfidence).filter((x): x is number => x != null);
  const headerAvg = h.length ? h.reduce((a, b) => a + b, 0) / h.length : null;
  const lineMin = l.length ? Math.min(...l) : null;
  if (headerAvg == null) return lineMin;
  if (lineMin == null) return headerAvg;
  return Math.min(headerAvg, lineMin);
}

const TO_BASE: Record<string, string> = { g: "kg", ml: "l", cl: "l", dl: "l" };

export function unitFactor(from: string | null | undefined, to: string | null | undefined): number | null {
  const f = (from ?? "").toLowerCase();
  const t = (to ?? "").toLowerCase();
  if (!f || !t) return null;
  if (f === t) return 1;
  const table: Record<string, number> = { "g>kg": 0.001, "kg>g": 1000, "ml>l": 0.001, "cl>l": 0.01, "dl>l": 0.1, "l>ml": 1000 };
  return table[`${f}>${t}`] ?? null;
}

const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const r2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export interface ReadLine {
  quantity: number | null; unit: string | null; unit_price: number | null; total_amount: number | null;
  package_size: number | null; package_unit: string | null; count_per_package: number | null;
}

/** Samme regel som rm_line_read_issues: mengde × pris mot linjesum, også via pakning og enhetsfaktor. */
export function lineReadIssues(l: ReadLine): ReadIssue[] {
  const { quantity: q, unit_price: p, total_amount: t } = l;
  if (t == null) return [{ code: "linjesum_mangler", message: "Linjesummen mangler. Les den av originalen." }];
  if (!fin(t) || (q != null && !fin(q)) || (p != null && !fin(p))) return [{ code: "ugyldig_tall", message: "Et tall på linjen er ikke gyldig." }];
  if (q == null || p == null) return [];
  if (q === 0 && t !== 0) return [{ code: "mengde_null", message: "Mengden er 0, men linjen har et beløp." }];
  const tol = Math.max(0.02, 0.015 * Math.abs(t));
  const plain = q * p;
  const cands = [plain];
  const pkg = fin(l.package_size) && l.package_size > 0 ? l.package_size * (l.count_per_package && l.count_per_package !== 0 ? l.count_per_package : 1) : null;
  if (pkg != null) {
    cands.push(q * pkg * p);
    const base = TO_BASE[(l.package_unit ?? "").toLowerCase()];
    const f1 = base ? unitFactor(l.package_unit, base) : null;
    if (f1 != null) cands.push(q * pkg * f1 * p);
    const f2 = unitFactor(l.package_unit, l.unit);
    if (f2 != null && f2 > 0 && ["g", "kg", "ml", "cl", "dl", "l"].includes((l.unit ?? "").toLowerCase())) cands.push((q / (pkg * f2)) * p);
  }
  if (cands.some((c) => Math.abs(Math.abs(c) - Math.abs(t)) <= tol)) return [];
  if (Math.abs(t) < Math.abs(plain) && Math.abs(t) >= 0.5 * Math.abs(plain)) {
    return [{ code: "mulig_rabatt", message: `Linjesummen ${r2(t)} er lavere enn mengde × pris (${r2(plain)}). Kontroller rabatt mot originalen.` }];
  }
  return [{ code: "regnestykke", message: `Mengde × pris (${r2(plain)}) stemmer ikke med linjesummen (${r2(t)}).` }];
}

const VAT_RATIOS = [1.25, 1.15, 1.12, 1 / 1.25, 1 / 1.15, 1 / 1.12];

/**
 * Sumavvik med samme forhold som en mva-sats. Vi skalerer ALDRI beløpene: en
 * manglende linje kan gi nøyaktig samme forhold. Returnerer et varsel eller null.
 */
export function vatRatioIssue(linesSumExclVat: number | null, totalInclVat: number | null, totalVat: number | null): ReadIssue | null {
  if (!fin(linesSumExclVat) || !fin(totalInclVat)) return null;
  const expected = totalInclVat - (fin(totalVat) ? totalVat : 0);
  if (expected === 0) return null;
  const ratio = linesSumExclVat / expected;
  if (Math.abs(ratio - 1) <= 0.02) return null;
  if (!VAT_RATIOS.some((r) => Math.abs(ratio - r) <= 0.005)) return null;
  return {
    code: "sumavvik_mva_forhold",
    message: `Linjesummen avviker fra fakturabeløpet eks. mva med forholdet ${ratio.toFixed(4)}, det samme som en mva-sats. Det kan være en mva-feil, men også en manglende linje. Ingen beløp er endret – kontroller mot originalen.`,
  };
}

/** Et tomt linjeresultat er ikke et svar: prøv igjen (inntil maks forsøk). */
export function shouldRetryExtraction(lines: unknown, attempt: number, maxAttempts = 2): boolean {
  const n = Array.isArray(lines) ? lines.length : 0;
  return n === 0 && attempt < maxAttempts;
}
