// AI-sikkerhet uttrykkes med tre nivåer — aldri en global prosent som
// hovedsignal. Prosenttall er teknisk støy for en saksbehandler; «Høy»,
// «Middels» og «Lav» er beslutningsspråk.

export type ConfidenceLevel = "high" | "medium" | "low";

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  high: "Høy sikkerhet",
  medium: "Middels sikkerhet",
  low: "Lav sikkerhet",
};

export const CONFIDENCE_SHORT: Record<ConfidenceLevel, string> = {
  high: "Høy",
  medium: "Middels",
  low: "Lav",
};

/** Semantiske tokens — StatusPill tegner selv ring/fyll fra disse. */
export const CONFIDENCE_TOKEN: Record<ConfidenceLevel, string> = {
  high: "--state-success",
  medium: "--state-warning",
  low: "--state-danger",
};

/** Normaliserer 0–1 og 0–100 til samme skala. */
export function normalizeScore(raw: number | null | undefined): number | null {
  if (raw == null || Number.isNaN(raw)) return null;
  const v = raw > 1 ? raw / 100 : raw;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export type ConfidenceThresholds = { high: number; medium: number };

/** Standardgrenser — kan overstyres i Innstillinger → Ordrekontor. */
export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = { high: 0.85, medium: 0.6 };

export function confidenceLevel(
  raw: number | null | undefined,
  thresholds: ConfidenceThresholds = DEFAULT_CONFIDENCE_THRESHOLDS,
): ConfidenceLevel | null {
  const v = normalizeScore(raw);
  if (v == null) return null;
  if (v >= thresholds.high) return "high";
  if (v >= thresholds.medium) return "medium";
  return "low";
}

export type FieldSuggestion = {
  /** Teknisk feltnavn, f.eks. `delivery_date`. */
  field: string;
  /** Norsk etikett vist i UI. */
  label: string;
  value: string;
  level: ConfidenceLevel;
  /** Belegg/kildetekst — hvorfor AI mener dette. */
  evidence: string | null;
};
