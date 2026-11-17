// «Slå sammen varer»: enhetsomregning. Speiler `_rm_merge_unit_factor` / `_rm_merge_needs_weight` i
// supabase/pending/20261120_slaa_sammen_varer.PENDING.sql. Ren logikk (testes).
import { parseDecimal } from "@/fakturaer/lib/units";

const MASS: Record<string, number> = { kg: 1000, g: 1 };
const VOLUME: Record<string, number> = { l: 1000, dl: 100, cl: 10, ml: 1 };
const norm = (u: string | null | undefined) => (u ?? "").trim().toLowerCase();
export const MAX_GRAMS_PER_PIECE = 1_000_000;

/** Antall beholdt-enheter per én enhet av varen som slås sammen. Null = kan ikke regnes om (med denne stykkvekten). */
export function unitFactor(keepUnit: string | null | undefined, dupUnit: string | null | undefined, gramsPerPiece: number | null): number | null {
  const k = norm(keepUnit), d = norm(dupUnit);
  if (!k || !d) return null;
  if (k === d) return 1;
  if (MASS[k] && MASS[d]) return MASS[d] / MASS[k];
  if (VOLUME[k] && VOLUME[d]) return VOLUME[d] / VOLUME[k];
  if (gramsPerPiece == null || !(gramsPerPiece > 0) || gramsPerPiece > MAX_GRAMS_PER_PIECE) return null;
  if (k === "stk" && MASS[d]) return MASS[d] / gramsPerPiece;
  if (d === "stk" && MASS[k]) return gramsPerPiece / MASS[k];
  return null;
}

/** Vekt ↔ stk kan regnes om med stykkvekt («1 stk = x g»). */
export function needsWeight(keepUnit: string | null | undefined, dupUnit: string | null | undefined): boolean {
  const k = norm(keepUnit), d = norm(dupUnit);
  return (k === "stk" && !!MASS[d]) || (d === "stk" && !!MASS[k]);
}

export type Conversion =
  | { kind: "same"; factor: 1 }
  | { kind: "fixed"; factor: number }
  | { kind: "weight"; grams: number | null; factor: number | null; error: string | null }
  | { kind: "impossible" };

/** Hvordan varen som slås sammen regnes om til beholdt enhet. `gramsText` er brukerens «1 stk = [x] g». */
export function conversionFor(keepUnit: string, dupUnit: string, gramsText: string): Conversion {
  const fixed = unitFactor(keepUnit, dupUnit, null);
  if (fixed === 1) return { kind: "same", factor: 1 };
  if (fixed != null) return { kind: "fixed", factor: fixed };
  if (!needsWeight(keepUnit, dupUnit)) return { kind: "impossible" };
  if (!gramsText.trim()) return { kind: "weight", grams: null, factor: null, error: null };
  const g = parseDecimal(gramsText);
  if (g == null || !(g > 0)) return { kind: "weight", grams: null, factor: null, error: "Skriv et positivt tall." };
  if (g > MAX_GRAMS_PER_PIECE) return { kind: "weight", grams: null, factor: null, error: "Tallet er for stort." };
  return { kind: "weight", grams: g, factor: unitFactor(keepUnit, dupUnit, g), error: null };
}

/** Er omregningen gyldig nok til å slå sammen? */
export const conversionReady = (c: Conversion): boolean => c.kind === "same" || c.kind === "fixed" || (c.kind === "weight" && c.factor != null);

/** Kostpris omregnet til beholdt enhet: kr per duplikat-enhet ÷ faktor. Null = ukjent. */
export function costInKeepUnit(cost: number | null, factor: number | null): number | null {
  if (cost == null || factor == null || !(factor > 0) || !Number.isFinite(cost)) return null;
  const v = cost / factor;
  return Number.isFinite(v) ? v : null;
}

interface PackSide { base_unit: string; unit_weight_grams: number | null; suppliers: readonly { supplier_id: string; package_size: number | null; package_unit: string | null; base_units_per_package: number | null }[] }

/**
 * Forslag til «1 stk = x g»: stykkvekt på stk-varen, ellers stk-varens pakning skrevet i vekt (f.eks. 2,4 kg = 20 stk),
 * ellers samme leverandørs pakning på begge varer (kg per kartong ÷ stk per kartong). Null = ingen kilde.
 */
export function weightPrefill(a: PackSide, b: PackSide): number | null {
  const stk = norm(a.base_unit) === "stk" ? a : norm(b.base_unit) === "stk" ? b : null;
  const mass = stk === a ? b : a;
  if (!stk || !MASS[norm(mass.base_unit)]) return null;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  if (stk.unit_weight_grams != null && stk.unit_weight_grams > 0) return round(stk.unit_weight_grams);
  for (const s of stk.suppliers) {
    const pu = MASS[norm(s.package_unit)];
    if (pu && s.package_size && s.package_size > 0 && s.base_units_per_package && s.base_units_per_package > 0) {
      return round((s.package_size * pu) / s.base_units_per_package);
    }
  }
  for (const s of stk.suppliers) {
    const m = mass.suppliers.find((x) => x.supplier_id === s.supplier_id);
    if (m?.base_units_per_package && m.base_units_per_package > 0 && s.base_units_per_package && s.base_units_per_package > 0) {
      return round((m.base_units_per_package * MASS[norm(mass.base_unit)]) / s.base_units_per_package);
    }
  }
  return null;
}
