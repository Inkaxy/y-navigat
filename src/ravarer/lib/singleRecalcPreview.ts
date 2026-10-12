/**
 * R192: streng leser for det eksisterende enkeltkallet `recalc_raw_material_cost(p_raw_material_id, p_dry_run=true)`.
 * Kontrakten er lest fra live-definisjonen (root-revisjon 2026-10-12). Hele svaret må stemme — ellers `null`
 * (forhåndsvisning utilgjengelig). Ingen felt fylles inn, ingen tall tvinges fra tekst, og ingen per-linje
 * «endret»-flagg utledes: serverens `lines_changed` er eneste kilde for antall endrede linjer.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const BAD = Symbol("bad");
type Bad = typeof BAD;

/** Felt som må finnes (kan være null). Bare ekte endelige JSON-tall. */
function numOrNull(o: Rec, k: string): number | null | Bad {
  if (!(k in o)) return BAD;
  const v = o[k];
  if (v === null) return null;
  return typeof v === "number" && Number.isFinite(v) ? v : BAD;
}
function strOrNull(o: Rec, k: string): string | null | Bad {
  if (!(k in o)) return BAD;
  const v = o[k];
  return v === null ? null : typeof v === "string" ? v : BAD;
}
function boolOrNull(o: Rec, k: string): boolean | null | Bad {
  if (!(k in o)) return BAD;
  const v = o[k];
  return v === null ? null : typeof v === "boolean" ? v : BAD;
}
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
function validDate(s: string): boolean {
  const m = DATE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export const KNOWN_METHODS = ["direkte", "pakning", "mangler_antall", "ukjent_enhet", "null_mengde"] as const;
export type KnownMethod = (typeof KNOWN_METHODS)[number];

export interface PreviewChange {
  lineId: string;
  invoiceDate: string | null;
  invoiceNumber: string | null;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  totalAmount: number | null;
  oldPpb: number | null;
  newPpb: number | null;
  applies: boolean | null;
  previewReason: string | null;
  newBaseQty: number | null;
  method: string;
  factor: number | null;
  factorSource: string | null;
  locked: boolean;
  /** Bare til stede når serveren hadde en positiv median. Diagnostikk, ikke regel. */
  avvikPct?: number | null;
}

export interface SinglePreview {
  rawMaterial: string;
  baseUnit: string;
  linesTotal: number;
  linesChanged: number;
  linesUnknown: number;
  linesOutlier: number;
  linesLocked: number;
  linesPreviewOnly: number;
  linesExcluded: number;
  ppbMedian: number | null;
  costBefore: number | null;
  costAfter: number | null;
  changes: PreviewChange[];
}

export type SinglePreviewResult = { kind: "ok"; preview: SinglePreview } | { kind: "server_error" } | { kind: "malformed" };

function parseChange(v: unknown): PreviewChange | null {
  if (!isRec(v)) return null;
  const lineId = v.line_id;
  if (typeof lineId !== "string" || !UUID.test(lineId)) return null;
  const invoiceDate = strOrNull(v, "invoice_date");
  const invoiceNumber = strOrNull(v, "invoice_number");
  const description = strOrNull(v, "description");
  const quantity = numOrNull(v, "quantity");
  const unit = strOrNull(v, "unit");
  const totalAmount = numOrNull(v, "total_amount");
  const oldPpb = numOrNull(v, "old_ppb");
  const newPpb = numOrNull(v, "new_ppb");
  const applies = boolOrNull(v, "applies");
  const previewReason = strOrNull(v, "preview_reason");
  const newBaseQty = numOrNull(v, "new_base_qty");
  const factor = numOrNull(v, "factor");
  const factorSource = strOrNull(v, "factor_source");
  const method = v.method;
  const locked = v.locked;
  const all = [invoiceDate, invoiceNumber, description, quantity, unit, totalAmount, oldPpb, newPpb, applies, previewReason, newBaseQty, factor, factorSource];
  if (all.some((x) => x === BAD)) return null;
  if (typeof method !== "string" || method === "" || typeof locked !== "boolean") return null;
  if (typeof invoiceDate === "string" && !validDate(invoiceDate)) return null;
  // Låst linje: aldri anvendt, og enhetsprisen er den gamle (null-sikkert).
  if (locked && (applies !== false || newPpb !== oldPpb)) return null;
  const out: PreviewChange = {
    lineId, invoiceDate: invoiceDate as string | null, invoiceNumber: invoiceNumber as string | null, description: description as string | null,
    quantity: quantity as number | null, unit: unit as string | null, totalAmount: totalAmount as number | null,
    oldPpb: oldPpb as number | null, newPpb: newPpb as number | null, applies: applies as boolean | null,
    previewReason: previewReason as string | null, newBaseQty: newBaseQty as number | null, method,
    factor: factor as number | null, factorSource: factorSource as string | null, locked,
  };
  if ("avvik_pct" in v) {
    const a = numOrNull(v, "avvik_pct");
    if (a === BAD) return null;
    out.avvikPct = a;
  }
  if ("outlier" in v && typeof v.outlier !== "boolean") return null;
  return out;
}

export function parseSingleRecalcPreview(data: unknown): SinglePreviewResult {
  if (!isRec(data)) return { kind: "malformed" };
  if (data.ok === false && typeof data.error === "string") return { kind: "server_error" };
  if (data.ok !== true || data.dry_run !== true || !("recalc_id" in data) || data.recalc_id !== null) return { kind: "malformed" };
  if (typeof data.raw_material !== "string" || typeof data.base_unit !== "string") return { kind: "malformed" };
  const factor = numOrNull(data, "factor");
  const factorSource = strOrNull(data, "factor_source");
  const ppbMedian = numOrNull(data, "ppb_median");
  const costBefore = numOrNull(data, "cost_before");
  const costAfter = numOrNull(data, "cost_after");
  if ([factor, factorSource, ppbMedian, costBefore, costAfter].some((x) => x === BAD)) return { kind: "malformed" };
  if (typeof data.manual_cost_protected !== "boolean") return { kind: "malformed" };
  const keys = ["lines_total", "lines_changed", "lines_unknown", "lines_outlier", "lines_locked", "lines_preview_only", "lines_excluded"] as const;
  if (!keys.every((k) => isCount(data[k]))) return { kind: "malformed" };
  const c = Object.fromEntries(keys.map((k) => [k, data[k] as number])) as Record<(typeof keys)[number], number>;
  if (!Array.isArray(data.changes) || data.changes.length !== c.lines_total) return { kind: "malformed" };
  for (const k of ["lines_changed", "lines_unknown", "lines_locked", "lines_preview_only", "lines_outlier"] as const) if (c[k] > c.lines_total) return { kind: "malformed" };
  const changes: PreviewChange[] = [];
  const seen = new Set<string>();
  for (const raw of data.changes) {
    const ch = parseChange(raw);
    if (!ch || seen.has(ch.lineId.toLowerCase())) return { kind: "malformed" };
    seen.add(ch.lineId.toLowerCase());
    changes.push(ch);
  }
  if (changes.filter((x) => x.locked).length !== c.lines_locked) return { kind: "malformed" };
  if (changes.filter((x) => x.newBaseQty === null).length !== c.lines_unknown) return { kind: "malformed" };
  return {
    kind: "ok",
    preview: {
      rawMaterial: data.raw_material, baseUnit: data.base_unit,
      linesTotal: c.lines_total, linesChanged: c.lines_changed, linesUnknown: c.lines_unknown, linesOutlier: c.lines_outlier,
      linesLocked: c.lines_locked, linesPreviewOnly: c.lines_preview_only, linesExcluded: c.lines_excluded,
      ppbMedian: ppbMedian as number | null, costBefore: costBefore as number | null, costAfter: costAfter as number | null, changes,
    },
  };
}

export const FACTOR_SOURCE_LABEL: Record<string, string> = {
  linje_bekreftet: "Bekreftet pakning på linjen",
  variant_varenr: "Bekreftet leverandørvariant (varenummer)",
  linje_ulest: "Pakning på linjen, ikke bekreftet",
  variant: "Gjeldende leverandørvariant (ikke historisk godkjenning)",
  leverandor: "Gjeldende leverandørfaktor (ikke historisk godkjenning)",
  ravare: "Gjeldende råvarefaktor (ikke historisk godkjenning)",
};
export const factorSourceLabel = (s: string | null) => (s == null ? "Ingen faktorkilde" : FACTOR_SOURCE_LABEL[s] ?? `Ukjent kilde (${s}) — ikke forklart`);

export const METHOD_LABEL: Record<KnownMethod, string> = {
  direkte: "Direkte enhetsomregning",
  pakning: "Pakning × faktor",
  mangler_antall: "Mangler antall",
  ukjent_enhet: "Ukjent enhet",
  null_mengde: "Mengden er null",
};
export const methodLabel = (m: string) => ((KNOWN_METHODS as readonly string[]).includes(m) ? METHOD_LABEL[m as KnownMethod] : `Ukjent metode (${m}) — ikke forklart`);
