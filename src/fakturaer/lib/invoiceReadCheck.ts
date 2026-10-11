// Lesekontroll for fakturalinjer — delt mellom nettleseren og edge-funksjoner.
// Filen må være byte-identisk med supabase/functions/_shared/invoiceReadCheck.ts
// (test vokter dette) og fri for Deno- og nettleser-spesifikke API-er.
// Regnereglene speiler databasefunksjonen public.rm_line_read_issues.

export type ReadIssueCode =
  | "linjesum_mangler" | "ugyldig_tall" | "mengde_null" | "mulig_rabatt" | "regnestykke"
  | "mengde_eller_pris_mangler" | "fortegn" | "prisgrunnlag_uavklart"
  | "sumavvik_mva_forhold" | "tomt_resultat" | "tvetydig_tall";

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
  } else if ((s.match(/\./g) ?? []).length > 1) {
    // «1.234.567» — flere punktum kan bare være tusenskille.
    if (!/^\d{1,3}(\.\d{3})+$/.test(s.replace(/^[-+]/, ""))) return null;
    s = s.replace(/\./g, "");
  } else if (/^\d{1,3}\.\d{3}$/.test(s.replace(/^[-+]/, ""))) {
    // «10.000» er tvetydig (10 eller 10 000) — tolkes aldri blindt. Se numberTokens.ts for feltbevisst avgjørelse.
    return null;
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

/** Hva enhetsprisen gjelder per. null = ukjent (godtas aldri stille via pakning/vekt). */
export type PriceBasis = "mengdeenhet" | "pakning" | "stk" | "kg" | "g" | "l" | "ml";
export const PRICE_BASES: readonly PriceBasis[] = ["mengdeenhet", "pakning", "stk", "kg", "g", "l", "ml"];

export interface ReadLine {
  quantity: number | null; unit: string | null; unit_price: number | null; total_amount: number | null;
  package_size: number | null; package_unit: string | null; count_per_package: number | null;
  unit_price_basis?: string | null; discount_amount?: number | null; line_kind?: string | null; is_credit?: boolean;
}

const MEASURE = ["g", "kg", "ml", "cl", "dl", "l"];

/** Samme regel som rm_line_read_issues_v2: fortegn, prisgrunnlag og rabatt kontrolleres eksplisitt. */
export function lineReadIssues(l: ReadLine): ReadIssue[] {
  const { quantity: q, unit_price: p, total_amount: t } = l;
  const kind = (l.line_kind ?? "").trim().toLowerCase() || "vare";
  const basis = (l.unit_price_basis ?? "").trim().toLowerCase() || null;
  const unit = (l.unit ?? "").toLowerCase();
  const pu = (l.package_unit ?? "").toLowerCase();
  const credit = l.is_credit === true;
  const disc = fin(l.discount_amount) ? l.discount_amount : 0;
  if (t == null) return [{ code: "linjesum_mangler", message: "Linjesummen mangler. Les den av originalen." }];
  if (!fin(t) || (q != null && !fin(q)) || (p != null && !fin(p))) return [{ code: "ugyldig_tall", message: "Et tall på linjen er ikke gyldig." }];
  if (kind === "rabatt" && !credit && t > 0) {
    return [{ code: "fortegn", message: "Rabattlinjen har positivt beløp på en vanlig faktura. Kontroller fortegnet mot originalen." }];
  }
  if (q == null || p == null) {
    if (kind !== "vare") return [];
    const msg = q == null && p == null ? "Mengde og enhetspris mangler. Les dem av originalen." : q == null ? "Mengden mangler. Les den av originalen." : "Enhetsprisen mangler. Les den av originalen.";
    return [{ code: "mengde_eller_pris_mangler", message: msg }];
  }
  if (q === 0 && t !== 0) return [{ code: "mengde_null", message: "Mengden er 0, men linjen har et beløp." }];
  const tol = Math.max(0.02, 0.015 * Math.abs(t));
  const plain = q * p;
  const pkg = fin(l.package_size) && l.package_size > 0 ? l.package_size * (l.count_per_package && l.count_per_package !== 0 ? l.count_per_package : 1) : null;
  let expected: number;
  if (basis == null || basis === "mengdeenhet") expected = plain;
  else if (basis === "pakning") {
    const f = unitFactor(unit, pu);
    expected = MEASURE.includes(unit) && pkg != null && f != null ? ((q * f) / pkg) * p : plain;
  } else if (basis === "stk") {
    const c = l.count_per_package;
    expected = fin(c) && c > 0 && !MEASURE.includes(unit) && unit !== "stk" && unit !== "st" ? q * c * p : plain;
  } else {
    const f = unitFactor(unit, basis);
    const fp = unitFactor(pu, basis);
    const qb = f != null ? q * f : pkg != null && fp != null ? q * pkg * fp : null;
    if (qb == null) return [{ code: "prisgrunnlag_uavklart", message: `Prisen er per ${basis}, men mengden kan ikke regnes om (mangler pakning i vekt/volum).` }];
    expected = qb * p;
  }
  if (disc > 0) expected = expected - Math.sign(expected) * disc;
  if (Math.abs(expected - t) <= tol) return [];
  if (credit && Math.abs(-expected - t) <= tol) return [];
  if (!credit && Math.abs(Math.abs(expected) - Math.abs(t)) <= tol) {
    return [{ code: "fortegn", message: `Beløpet ${r2(t)} har motsatt fortegn av mengde × pris (${r2(expected)}) på en vanlig faktura. Kontroller retur/rabatt mot originalen.` }];
  }
  if (basis == null && pkg != null) {
    const base = TO_BASE[pu];
    const f1 = base ? unitFactor(pu, base) : null;
    const f2 = unitFactor(unit, pu);
    const c = l.count_per_package;
    const cands = [
      q * pkg * p,
      q * pkg * (f1 ?? 0) * p,
      MEASURE.includes(unit) && f2 != null ? ((q * f2) / pkg) * p : null,
      fin(c) && c > 0 ? q * c * p : null,
    ];
    const hit = cands.find((x): x is number => x != null && x !== 0 && (Math.abs(x - t) <= tol || (credit && Math.abs(-x - t) <= tol)));
    if (hit != null) {
      return [{ code: "prisgrunnlag_uavklart", message: `Mengde × pris (${r2(plain)}) stemmer ikke, men summen passer med pris per pakning/vekt (${r2(hit)}). Angi prisgrunnlaget i «Rett fakturalinje».` }];
    }
  }
  if (Math.abs(t) < Math.abs(expected) && Math.abs(t) >= 0.5 * Math.abs(expected) && Math.sign(t) === Math.sign(expected) && disc === 0) {
    return [{ code: "mulig_rabatt", message: `Linjesummen ${r2(t)} er lavere enn mengde × pris (${r2(expected)}). Registrer rabatten eller kontroller mot originalen.` }];
  }
  return [{ code: "regnestykke", message: `Mengde × pris (${r2(expected)}) stemmer ikke med linjesummen (${r2(t)}).` }];
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
