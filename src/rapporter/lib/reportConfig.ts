/**
 * Serialisering av rapportutvalg til/fra URL-params.
 *
 * Konvensjon:
 * - `start` + `end` i URL-en betyr «egendefinert periode» (preset = 'custom')
 *   med mindre `preset` er eksplisitt satt.
 * - Manglende params faller tilbake til sidens defaults.
 * - `config`-jsonb i report_definitions bruker nøyaktig de samme nøklene som
 *   querystringen, slik at «åpne rapport» blir en ren serialisering.
 */
import {
  PERIOD_PRESET_LABELS,
  COMPARE_LABELS,
  rangeForPreset,
  type ComparePreset,
  type DateRange,
  type PeriodPreset,
} from "@/rapporter/lib/periods";

export type ReportKind = "statistikk" | "trender" | "kunder" | "sammenligning";

export type ReportConfig = Record<string, string>;

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  statistikk: "Statistikk",
  trender: "Trender",
  kunder: "Kunder",
  sammenligning: "Sammenligning",
};

export const REPORT_KIND_PATHS: Record<ReportKind, string> = {
  statistikk: "/rapporter/statistikk",
  trender: "/rapporter/trender",
  kunder: "/rapporter/kunder",
  sammenligning: "/rapporter/sammenligning",
};

/** Bygger lenken som gjenåpner et lagret utvalg. */
export function reportHref(kind: ReportKind, config: ReportConfig | null | undefined): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(config ?? {})) {
    if (v != null && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${REPORT_KIND_PATHS[kind]}?${s}` : REPORT_KIND_PATHS[kind];
}

const PRESETS = new Set(PERIOD_PRESET_LABELS.map((p) => p.value as string));
const COMPARES = new Set(COMPARE_LABELS.map((c) => c.value as string));

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Leser periode fra URL etter konvensjonen over. */
export function readPeriod(
  params: URLSearchParams,
  defaultPreset: PeriodPreset = "ytd",
): { preset: PeriodPreset; range: DateRange } {
  const start = params.get("start");
  const end = params.get("end");
  const rawPreset = params.get("preset");
  const preset = rawPreset && PRESETS.has(rawPreset) ? (rawPreset as PeriodPreset) : null;

  if (start && end && ISO.test(start) && ISO.test(end)) {
    return { preset: preset ?? "custom", range: { start, end } };
  }
  const p = preset ?? defaultPreset;
  return { preset: p, range: rangeForPreset(p) };
}

export function readCompare(
  params: URLSearchParams,
  fallback: ComparePreset = "same_period_last_year",
): ComparePreset {
  const v = params.get("compare");
  return v && COMPARES.has(v) ? (v as ComparePreset) : fallback;
}

export function readUuid(params: URLSearchParams, key: string): string | null {
  const v = params.get(key);
  return v && v.length >= 8 ? v : null;
}

export function readDate(params: URLSearchParams, key: string, fallback: string): string {
  const v = params.get(key);
  return v && ISO.test(v) ? v : fallback;
}

/** Fjerner tomme verdier fra et config-objekt. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readUuid(params: URLSearchParams, key: string): string | null {
  const v = params.get(key);
  return v && UUID.test(v) ? v : null;
}

export function cleanConfig(config: Record<string, string | null | undefined>): ReportConfig {
  const out: ReportConfig = {};
  for (const [k, v] of Object.entries(config)) {
    if (v != null && v !== "") out[k] = String(v);
  }
  return out;
}
