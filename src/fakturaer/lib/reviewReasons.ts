import { normalizeMatchKey } from "@/fakturaer/lib/matchNormalize";

/**
 * ÉN kilde til hva en fakturalinje står til gjennomgang for.
 *
 * `invoice_lines.review_reason` er en kommaseparert liste: en linje kan både
 * mangle pakning OG ha prisavvik. Tidligere leste køen bare den første verdien,
 * og alt den ikke kjente igjen havnet under «Umatchet». Her er alle faktiske
 * årsaker typet, gruppert og utstyrt med en ærlig «ukjent»-bøtte.
 */

/** Årsaker matchemotoren faktisk skriver på linjen. */
export const LINE_REASON_CODES = [
  "unmatched",
  "low_confidence",
  "price_variance",
  "price_increase",
  "price_drop",
  "uncertain_cost",
  "unknown_package_size",
  "sku_collision",
  "unsupported_currency",
  "agreement_conflict",
  "price_reference_error",
] as const;
export type LineReasonCode = (typeof LINE_REASON_CODES)[number];

/** Årsaker vi utleder av linjens og fakturaens egne felter. */
export const DERIVED_REASON_CODES = ["no_baseline", "extraction_issue", "zero_quantity"] as const;
export type DerivedReasonCode = (typeof DERIVED_REASON_CODES)[number];

export type ReasonCode = LineReasonCode | DerivedReasonCode;

export const REASON_LABELS: Record<ReasonCode, string> = {
  unmatched: "Umatchet",
  low_confidence: "Lav tillit",
  price_variance: "Prisavvik",
  price_increase: "Prisøkning",
  price_drop: "Prisfall",
  uncertain_cost: "Usikker kostpris",
  unknown_package_size: "Ukjent pakningsstørrelse",
  sku_collision: "Konflikt",
  unsupported_currency: "Valuta ikke støttet",
  agreement_conflict: "To likestilte avtaler",
  no_baseline: "Uten prisgrunnlag",
  extraction_issue: "Uttrekk eller sum stemmer ikke",
  zero_quantity: "Mengde mangler eller er null",
};

/** Arbeidsbøttene i køen. `other` er den ærlige fallbacken. */
export const REVIEW_GROUPS = [
  "unknown_item",
  "uncertain_match",
  "package_unit",
  "no_baseline",
  "price_increase",
  "price_drop",
  "price_variance",
  "currency",
  "extraction",
  "conflict",
  "other",
] as const;
export type ReviewGroup = (typeof REVIEW_GROUPS)[number];

export const GROUP_LABELS: Record<ReviewGroup, string> = {
  unknown_item: "Ukjent vare",
  uncertain_match: "Usikker match",
  package_unit: "Pakning og enhet",
  no_baseline: "Uten prisgrunnlag",
  price_increase: "Prisøkning",
  price_drop: "Prisfall",
  price_variance: "Avvik fra prisgrunnlag",
  currency: "Valuta",
  extraction: "Uttrekk og sum",
  conflict: "Konflikt",
  other: "Ukjent årsak",
};

export const GROUP_DESCRIPTIONS: Record<ReviewGroup, string> = {
  unknown_item: "Linjen er ikke koblet til noen vare.",
  uncertain_match: "Motoren har et forslag, men er ikke sikker nok til å koble selv.",
  package_unit: "Pakning eller enhet er ukjent, så kiloprisen kan ikke regnes trygt.",
  no_baseline: "Varen er matchet, men det finnes verken avtale eller tidligere kjøp å måle mot.",
  price_increase: "Prisen har gått opp mot grunnlaget.",
  price_drop: "Prisen har gått ned mot grunnlaget.",
  price_variance: "Prisen ligger utenfor toleransen mot grunnlaget.",
  currency: "Fakturaen er i en annen valuta enn NOK, og omregnes ikke automatisk.",
  extraction: "Uttrekket fra dokumentet eller summen av linjene stemmer ikke med fakturaen.",
  conflict: "Samme varenummer eller navn peker på flere varer.",
  other: "Linjen står til gjennomgang uten en årsak vi kjenner igjen.",
};

const REASON_GROUP: Record<ReasonCode, ReviewGroup> = {
  unmatched: "unknown_item",
  low_confidence: "uncertain_match",
  unknown_package_size: "package_unit",
  uncertain_cost: "package_unit",
  zero_quantity: "package_unit",
  no_baseline: "no_baseline",
  price_increase: "price_increase",
  price_drop: "price_drop",
  price_variance: "price_variance",
  unsupported_currency: "currency",
  agreement_conflict: "conflict",
  extraction_issue: "extraction",
  sku_collision: "conflict",
};

const KNOWN: ReadonlySet<string> = new Set<string>([...LINE_REASON_CODES, ...DERIVED_REASON_CODES]);

export function isKnownReason(code: string): code is ReasonCode {
  return KNOWN.has(code);
}

export function reasonLabel(code: string): string {
  return isKnownReason(code) ? REASON_LABELS[code] : `Ukjent årsak (${code})`;
}

/** Feltene vi trenger for å klassifisere en linje. Alle flater deler denne formen. */
export interface ClassifiableLine {
  review_reason: string | null;
  requires_review?: boolean | null;
  variance_status?: string | null;
  raw_material_id?: string | null;
  quantity?: number | null;
  price_per_base_unit?: number | null;
  expected_price_per_base_unit?: number | null;
  price_variance_pct?: number | null;
  base_quantity?: number | null;
  total_amount?: number | null;
  supplier_sku?: string | null;
  description?: string | null;
  invoice?: {
    supplier_id?: string | null;
    currency?: string | null;
    lines_sum_status?: string | null;
    extraction_confidence?: number | null;
  } | null;
}

/** Årsakene motoren skrev på linjen, i rekkefølgen de står. */
export function storedReasons(line: Pick<ClassifiableLine, "review_reason">): string[] {
  return (line.review_reason ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

/** Årsaker vi utleder av linjens og fakturaens tilstand. */
export function derivedReasons(line: ClassifiableLine): DerivedReasonCode[] {
  const out: DerivedReasonCode[] = [];
  if (line.variance_status === "no_baseline" && line.raw_material_id) out.push("no_baseline");
  const inv = line.invoice;
  if (inv) {
    const sumMismatch = inv.lines_sum_status === "mismatch";
    const lowExtraction = inv.extraction_confidence != null && Number(inv.extraction_confidence) < 0.6;
    if (sumMismatch || lowExtraction) out.push("extraction_issue");
  }
  const q = line.quantity == null ? null : Number(line.quantity);
  if (line.requires_review && (q === 0 || (q != null && !Number.isFinite(q)))) out.push("zero_quantity");
  return out;
}

/** Alle årsaker på linjen — lagrede og utledede, uten duplikater. */
export function allReasons(line: ClassifiableLine): string[] {
  return [...new Set([...storedReasons(line), ...derivedReasons(line)])];
}

/** Gruppene linjen hører hjemme i. Tom årsaksliste på en gjennomgangslinje → «ukjent årsak». */
export function groupsOf(line: ClassifiableLine): ReviewGroup[] {
  const groups = new Set<ReviewGroup>();
  let sawUnknown = false;
  for (const r of allReasons(line)) {
    if (isKnownReason(r)) groups.add(REASON_GROUP[r]);
    else sawUnknown = true;
  }
  if (sawUnknown) groups.add("other");
  if (groups.size === 0 && line.requires_review) groups.add("other");
  return [...groups];
}

/** Filtrering: linjen treffer fanen hvis NOEN av årsakene hører til gruppen. */
export function matchesGroup(line: ClassifiableLine, group: ReviewGroup | "all"): boolean {
  if (group === "all") return true;
  return groupsOf(line).includes(group);
}

/**
 * Hvor mye linjen er verdt å rydde i, i kroner.
 *
 * Bare beregnet når grunnlaget faktisk finnes: pris per grunnenhet mot forventet
 * pris ganger mengde, ellers avviksprosent mot linjebeløpet. Kan den ikke regnes,
 * returneres `null` — og skal vises som «ukjent», aldri som null kroner.
 */
export function financialImpact(line: ClassifiableLine): number | null {
  const actual = num(line.price_per_base_unit);
  const expected = num(line.expected_price_per_base_unit);
  const baseQty = num(line.base_quantity);
  if (actual != null && expected != null && baseQty != null && baseQty > 0) {
    return Math.abs((actual - expected) * baseQty);
  }
  const pct = num(line.price_variance_pct);
  const total = num(line.total_amount);
  if (pct != null && total != null) return Math.abs((pct / 100) * total);
  return null;
}

function num(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Nøkkel for «samme vare fra samme leverandør». Brukes til å sortere etter
 * hvor mange ganger det samme problemet går igjen — det er der én avklaring
 * rydder mest.
 */
export function repeatKey(line: ClassifiableLine): string | null {
  const supplier = line.invoice?.supplier_id ?? "";
  const sku = normalizeMatchKey(line.supplier_sku);
  const name = normalizeMatchKey(line.description);
  const ident = sku || name;
  if (!ident) return null;
  return `${supplier}|${ident}`;
}

export function repeatCounts(lines: readonly ClassifiableLine[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const l of lines) {
    const k = repeatKey(l);
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

export type QueueSort = "invoice_date" | "impact" | "repeats";

/**
 * Sorterer køen uten å skjule det vi ikke vet: linjer med ukjent
 * kronepåvirkning legges sist, ikke som «0 kr».
 */
export function sortQueue<T extends ClassifiableLine & { id: string; invoice?: { invoice_date?: string } | null }>(
  lines: readonly T[],
  sort: QueueSort,
  counts?: Map<string, number>,
): T[] {
  const rows = [...lines];
  if (sort === "impact") {
    rows.sort((a, b) => {
      const ia = financialImpact(a);
      const ib = financialImpact(b);
      if (ia == null && ib == null) return a.id.localeCompare(b.id);
      if (ia == null) return 1;
      if (ib == null) return -1;
      if (ib !== ia) return ib - ia;
      return a.id.localeCompare(b.id);
    });
    return rows;
  }
  if (sort === "repeats") {
    const c = counts ?? repeatCounts(lines);
    rows.sort((a, b) => {
      const ka = repeatKey(a);
      const kb = repeatKey(b);
      const ra = ka ? (c.get(ka) ?? 0) : 0;
      const rb = kb ? (c.get(kb) ?? 0) : 0;
      if (rb !== ra) return rb - ra;
      return a.id.localeCompare(b.id);
    });
    return rows;
  }
  rows.sort((a, b) => {
    const d = (b.invoice?.invoice_date ?? "").localeCompare(a.invoice?.invoice_date ?? "");
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
  return rows;
}
