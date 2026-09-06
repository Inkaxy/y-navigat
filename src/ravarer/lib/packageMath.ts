// Regner ut hvor mange BASEENHETER en pakning inneholder, ut fra et forslag
// («500 g × 6») og råvarens baseenhet («kg»). Ren funksjon slik at regelen kan
// testes direkte — feil her skriver 3000 kg der det skulle stått 3 kg.
import { normalizeUnit, toBaseFactor } from "@/fakturaer/lib/units";

export interface PackageMathInput {
  /** Størrelse per sub-enhet, som tekst fra skjemaet. */
  size: string | number | null | undefined;
  /** Enheten størrelsen er oppgitt i («g», «ml», «stk»). */
  unit: string | null | undefined;
  /** Antall sub-enheter per pakning. Tom verdi tolkes som 1. */
  count?: string | number | null | undefined;
  /** Råvarens baseenhet. */
  baseUnit: string | null | undefined;
}

export type PackageMathResult =
  | { ok: true; baseUnits: number; factor: number; size: number; count: number }
  | { ok: false; error: string };

function parseNumber(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function computeBaseUnitsPerPackage(input: PackageMathInput): PackageMathResult {
  const size = parseNumber(input.size);
  if (size == null || size <= 0) return { ok: false, error: "Ugyldig pakningsstørrelse." };

  const rawCount = typeof input.count === "string" ? input.count.trim() : input.count;
  const count = rawCount === "" || rawCount == null ? 1 : parseNumber(rawCount);
  // Et ugyldig antall skal aldri falle tilbake til 1 — da ville «x» blitt 1 pakke.
  if (count == null || !Number.isFinite(count) || count <= 0) {
    return { ok: false, error: "Antall per pakke må være et positivt tall." };
  }

  const from = normalizeUnit(input.unit);
  const to = normalizeUnit(input.baseUnit);
  if (!from) return { ok: false, error: `Ukjent enhet «${input.unit ?? ""}».` };
  if (!to) return { ok: false, error: `Råvaren mangler en kjent baseenhet («${input.baseUnit ?? ""}»).` };

  const factor = toBaseFactor(from, to);
  if (factor == null) {
    return {
      ok: false,
      error: `Kan ikke regne om fra ${from} til ${to}. Sett pakningen manuelt.`,
    };
  }

  return { ok: true, baseUnits: size * count * factor, factor, size, count };
}

/**
 * Kontrakten for et forhåndsutfylt pakningsforslag (datablad, navnegjetting …).
 *
 * MERK skillet: `contentUnit` er INNHOLDSENHETEN («g», «ml», «kg»), mens
 * `packageType` er emballasjen («sekk», «eske»). De to må aldri blandes —
 * pakningsnedtrekket i dialogen inneholder bare emballasjetyper.
 */
export interface PackageFillSuggestion {
  /** Størrelse per sub-enhet i innholdsenheten, f.eks. 500 (g). */
  size: number | null;
  /** Innholdsenheten størrelsen er oppgitt i. */
  contentUnit: string | null;
  /** Antall sub-enheter per pakning. Tom verdi tolkes som 1. */
  count?: number | null;
  /** Emballasjetype, kun hvis den faktisk er kjent. */
  packageType?: string | null;
}

export type PackageFill =
  | { kind: "converted"; units: number; note: string }
  /** Forslaget vises, men uten en godkjent omregning — feltet fylles ikke ut. */
  | { kind: "unconvertible"; note: string }
  | { kind: "none" };

function fmt(n: number): string {
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 3 }).format(n);
}

/**
 * Regner et forslag om til ANTALL GRUNNENHETER, som er det pakningsdialogen
 * lagrer. 500 g fra et datablad på en kg-råvare skal bli 0,5 — ikke 500.
 */
export function resolvePackageFill(
  suggestion: PackageFillSuggestion | null | undefined,
  baseUnit: string | null | undefined,
): PackageFill {
  if (!suggestion) return { kind: "none" };
  if (suggestion.size == null || !Number.isFinite(suggestion.size)) {
    return {
      kind: "unconvertible",
      note: "Forslaget mangler en pakningsstørrelse. Fyll inn antall selv.",
    };
  }
  const math = computeBaseUnitsPerPackage({
    size: suggestion.size,
    unit: suggestion.contentUnit,
    count: suggestion.count ?? 1,
    baseUnit,
  });
  if (!math.ok) {
    const shown = `${fmt(suggestion.size)} ${suggestion.contentUnit ?? ""}`.trim();
    return {
      kind: "unconvertible",
      note: `${math.error} Forslaget «${shown}» må vurderes manuelt.`,
    };
  }
  const units = Number(math.baseUnits.toFixed(6));
  const from = `${fmt(math.size)} ${suggestion.contentUnit ?? ""}`.trim();
  const times = math.count !== 1 ? ` × ${fmt(math.count)}` : "";
  return {
    kind: "converted",
    units,
    note: `Forslag: ${from}${times} = ${fmt(units)} ${baseUnit ?? ""}`.trim(),
  };
}
