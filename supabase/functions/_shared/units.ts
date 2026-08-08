// Felles enhets-håndtering for fakturalinjer og databladet.
// Mål: oversette norske/EHF-koder til kanoniske enheter, og hente pakke-størrelse
// fra fritekst-beskrivelser.

export type CanonicalUnit =
  | "g" | "kg" | "ml" | "cl" | "dl" | "l"
  | "stk"
  | "eske" | "pakke" | "sekk" | "flaske" | "rull" | "spann" | "kanne" | "boks" | "brett";

const BASE_UNITS = new Set<CanonicalUnit>(["g", "kg", "ml", "cl", "dl", "l", "stk"]);

const PACKAGE_UNITS = new Set<CanonicalUnit>([
  "eske", "pakke", "sekk", "flaske", "rull", "spann", "kanne", "boks", "brett",
]);

const UNIT_ALIASES: Record<string, CanonicalUnit> = {
  // stk-familie
  stk: "stk", styk: "stk", st: "stk", stk_: "stk", pcs: "stk", pc: "stk", piece: "stk",
  pieces: "stk", ea: "stk", each: "stk", h87: "stk", c62: "stk", nar: "stk",
  // masse
  g: "g", gr: "g", gram: "g", grm: "g",
  kg: "kg", kilo: "kg", kgm: "kg", kilogram: "kg",
  // volum
  ml: "ml", mlt: "ml", milliliter: "ml",
  cl: "cl", clt: "cl", centiliter: "cl",
  dl: "dl", dlt: "dl", desiliter: "dl", deciliter: "dl",
  l: "l", lt: "l", ltr: "l", liter: "l", litre: "l",
  // pakke-familier
  esk: "eske", eske: "eske", ks: "eske", ksk: "eske", krt: "eske", krg: "eske",
  kart: "eske", kartong: "eske", bx: "eske", box: "eske", carton: "eske", ct: "eske",
  pk: "pakke", pak: "pakke", pakke: "pakke", pack: "pakke",
  pos: "sekk", sk: "sekk", sekk: "sekk", bag: "sekk", sack: "sekk",
  fl: "flaske", btl: "flaske", flaske: "flaske", bottle: "flaske",
  rl: "rull", rull: "rull", roll: "rull",
  spn: "spann", spann: "spann",
  kanne: "kanne",
  boks: "boks", can: "boks",
  brett: "brett", tray: "brett",
};

/** Normaliser en rå enhetskode til kanonisk form (lowercase). Returnerer null hvis ukjent. */
export function normalizeUnit(raw: string | null | undefined): CanonicalUnit | null {
  if (!raw) return null;
  const k = String(raw).trim().toLowerCase().replace(/\.$/, "");
  if (!k) return null;
  return UNIT_ALIASES[k] ?? null;
}

export function isBaseUnit(u: string | null | undefined): boolean {
  if (!u) return false;
  return BASE_UNITS.has(u as CanonicalUnit);
}

export function isPackageUnit(u: string | null | undefined): boolean {
  if (!u) return false;
  return PACKAGE_UNITS.has(u as CanonicalUnit);
}

/** Konverteringsfaktor mellom to base-enheter. Returnerer null for ukjent eller pakke-enheter. */
export function toBaseFactor(
  from: string | null | undefined,
  to: string | null | undefined,
): number | null {
  const f = normalizeUnit(from) ?? (from ? String(from).trim().toLowerCase() : null);
  const t = normalizeUnit(to) ?? (to ? String(to).trim().toLowerCase() : null);
  if (!f || !t) return null;
  if (f === t) return 1;
  // mass
  const mass: Record<string, number> = { g: 1, kg: 1000 };
  // volume
  const vol: Record<string, number> = { ml: 1, cl: 10, dl: 100, l: 1000 };
  if (f in mass && t in mass) return mass[f] / mass[t];
  if (f in vol && t in vol) return vol[f] / vol[t];
  return null;
}

export interface PackageInfo {
  /**
   * Størrelse per sub-enhet i base-enhet (f.eks. 10 for "10l", 90 for "36X90G").
   * Total pakningsstørrelse = size * count.
   */
  size: number;
  /** Base-enhet pakken er uttrykt i (kg/g/l/ml/dl/cl/stk). */
  unit: CanonicalUnit;
  /** Antall sub-pakker (f.eks. 36 for "36X90G", 12 for "12x500ml"). 1 hvis ikke spesifisert. */
  count: number;
  /** Kilden som ble matchet, for diagnostikk. */
  matched: string;
}

/**
 * Trekk ut pakke-størrelse fra norsk fakturabeskrivelse.
 * Definisjonen er identisk med AI-prompten: `size` er størrelsen PER sub-enhet,
 * og `count` er antall sub-enheter. Total = size * count.
 * Eksempler:
 *   "10l"          -> { size: 10,    unit: "l",  count: 1 }
 *   "2 kg"         -> { size: 2,     unit: "kg", count: 1 }
 *   "500ml"        -> { size: 500,   unit: "ml", count: 1 }
 *   "1/4l"         -> { size: 0.25,  unit: "l",  count: 1 }
 *   "36X90G"       -> { size: 90,    unit: "g",  count: 36 }
 *   "12 x 500 ML"  -> { size: 500,   unit: "ml", count: 12 }
 *   "6X1L"         -> { size: 1,     unit: "l",  count: 6 }
 */

export function parsePackageFromDescription(desc: string | null | undefined): PackageInfo | null {
  if (!desc) return null;
  const text = String(desc).replace(/\s+/g, " ").trim();
  if (!text) return null;

  // 1. Multiplikasjon: "36X90G", "12 x 500 ML", "6X1L"
  const mulRe = /(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gram|grm|gr|ml|mlt|cl|dl|l|lt|ltr|liter|litre)\b/i;
  const m = text.match(mulRe);
  if (m) {
    const count = toNumber(m[1]);
    const each = toNumber(m[2]);
    const unit = normalizeUnit(m[3]);
    if (count && each && unit) {
      return { size: each, unit, count, matched: m[0] };
    }
  }

  // 2. Brøk: "1/4l", "1/2 kg"
  const fracRe = /\b(\d+)\s*\/\s*(\d+)\s*(kg|g|gram|grm|gr|ml|mlt|cl|dl|l|lt|ltr|liter|litre)\b/i;
  const fr = text.match(fracRe);
  if (fr) {
    const num = toNumber(fr[1]);
    const den = toNumber(fr[2]);
    const unit = normalizeUnit(fr[3]);
    if (num && den && unit) {
      return { size: num / den, unit, count: 1, matched: fr[0] };
    }
  }

  // 3. Enkel størrelse: "10l", "2 kg", "500ml" — ta SISTE forekomst (mest spesifikk)
  const singleRe = /(\d+(?:[.,]\d+)?)\s*(kg|gram|grm|ml|mlt|cl|dl|liter|litre|ltr|lt|kilo|g|l)\b/gi;
  let last: RegExpExecArray | null = null;
  let cur: RegExpExecArray | null;
  while ((cur = singleRe.exec(text)) !== null) last = cur;
  if (last) {
    const size = toNumber(last[1]);
    const unit = normalizeUnit(last[2]);
    if (size && unit) {
      return { size, unit, count: 1, matched: last[0] };
    }
  }

  return null;
}

function toNumber(s: string): number | null {
  if (s == null) return null;
  const cleaned = String(s).replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Konverter en linje-mengde til base-enhet for en råvare.
 * Returnerer { baseQty, factor, source } eller null hvis vi ikke har nok info.
 *
 *  - quantity * factor = baseQty
 *  - unit_price / factor = price_per_base_unit
 */
export function quantityToBase(input: {
  quantity: number;
  unit: string | null | undefined;
  description?: string | null;
  baseUnit: string | null | undefined;
  /** Pakke-størrelse fra raw_material_suppliers (per "pakke" / "eske"). */
  rmsPackageSize?: number | null;
  rmsPackageUnit?: string | null;
  /** AI-utledede felt på linjen. package_size er PER sub-enhet. */
  linePackageSize?: number | null;
  linePackageUnit?: string | null;
  lineCountPerPackage?: number | null;
}): { baseQty: number; factor: number; source: string } | null {
  const { quantity, baseUnit } = input;
  if (!Number.isFinite(quantity) || !baseUnit) return null;
  const u = normalizeUnit(input.unit);
  const b = normalizeUnit(baseUnit) ?? baseUnit.toLowerCase();

  // Direkte base→base konvertering
  if (u && isBaseUnit(u)) {
    const f = toBaseFactor(u, b);
    if (f != null) return { baseQty: quantity * f, factor: f, source: "direct" };
    // u=stk og base=stk håndteres i toBaseFactor (=1). Mismatch (stk vs kg) trenger pakke.
  }

  // Pakke-enhet eller ukjent enhet → bruk pakke-størrelse.
  // size er per sub-enhet; total pakningsstørrelse = size * (count ?? 1).
  const pkgSources: Array<{ size: number; unit: string; src: string }> = [];
  if (input.linePackageSize && input.linePackageUnit) {
    const cnt = Number(input.lineCountPerPackage);
    const count = Number.isFinite(cnt) && cnt > 0 ? cnt : 1;
    pkgSources.push({ size: input.linePackageSize * count, unit: input.linePackageUnit, src: "ai_line" });
  }
  const fromDesc = parsePackageFromDescription(input.description);
  if (fromDesc) {
    pkgSources.push({ size: fromDesc.size * (fromDesc.count || 1), unit: fromDesc.unit, src: "description" });
  }
  if (input.rmsPackageSize && input.rmsPackageUnit) {
    pkgSources.push({ size: input.rmsPackageSize, unit: input.rmsPackageUnit, src: "rms" });
  }

  for (const p of pkgSources) {
    const pUnit = normalizeUnit(p.unit) ?? p.unit.toLowerCase();
    const f = toBaseFactor(pUnit, b);
    if (f != null) {
      const factor = p.size * f;
      return { baseQty: quantity * factor, factor, source: p.src };
    }
  }
  return null;
}

