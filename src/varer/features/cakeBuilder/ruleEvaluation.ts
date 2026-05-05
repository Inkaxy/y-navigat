/**
 * Sentral mapping og evaluering av compatibility rule_type for kakebyggeren.
 *
 * Single source of truth — alle apper og kodesteder som evaluerer regler
 * MÅ bruke `evaluateRule` / `normalizeRuleType` herfra. Da unngår vi at
 * "require_all" vs "require_all_selected"-mismatch oppstår igjen.
 */

/** Kanoniske rule_type-verdier som skrives til DB av editoren. */
export type CanonicalRuleType =
  | "require_all_selected"
  | "require_any_two_selected";

/** Alle aksepterte alias som vi normaliserer til en kanonisk type. */
const RULE_TYPE_ALIASES: Record<string, CanonicalRuleType> = {
  // Kanoniske (det editoren skriver i dag)
  require_all_selected: "require_all_selected",
  require_any_two_selected: "require_any_two_selected",
  // Bakoverkompatible kortformer (eldre data / eksterne integrasjoner)
  require_all: "require_all_selected",
  require_any_two: "require_any_two_selected",
  // Vennlige aliaser
  all: "require_all_selected",
  and: "require_all_selected",
  any_two: "require_any_two_selected",
};

/**
 * Normaliser et vilkårlig rule_type-string til kanonisk form.
 * Returnerer `null` hvis typen er ukjent (kalleren bestemmer fallback).
 */
export function normalizeRuleType(rule_type: string | null | undefined): CanonicalRuleType | null {
  if (!rule_type) return null;
  return RULE_TYPE_ALIASES[rule_type.trim().toLowerCase()] ?? null;
}

export interface EvaluateRuleInput {
  rule_type: string;
  trigger_product_ids: string[] | null | undefined;
  /** Sett av valgte product/option-IDs (i samme format som trigger_product_ids). */
  selectedIds: ReadonlySet<string>;
}

/**
 * Returnerer `true` hvis regelen skal trigges gitt de valgte ID-ene.
 *
 * Ukjente rule_type-verdier faller til "any trigger present" (mest forsiktig
 * fallback for å unngå at en regel forsvinner stille).
 */
export function evaluateRule({ rule_type, trigger_product_ids, selectedIds }: EvaluateRuleInput): boolean {
  const triggers = trigger_product_ids ?? [];
  if (triggers.length === 0) return false;

  const canonical = normalizeRuleType(rule_type);
  switch (canonical) {
    case "require_all_selected":
      return triggers.every((t) => selectedIds.has(t));
    case "require_any_two_selected": {
      let hits = 0;
      for (const t of triggers) {
        if (selectedIds.has(t)) hits++;
        if (hits >= 2) return true;
      }
      return false;
    }
    default:
      // Ukjent type — fall tilbake til "minst én trigger valgt"
      return triggers.some((t) => selectedIds.has(t));
  }
}
