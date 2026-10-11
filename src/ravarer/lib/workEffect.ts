import type { WorkItem } from "@/ravarer/lib/workRpcTypes";

export type WorkEffect =
  | { kind: "verified"; label: string; value: number }
  | { kind: "read"; label: string; detail: string }
  | { kind: "unknown"; label: string; detail: string }
  | { kind: "none"; label: string; detail: string };

/**
 * Hva arbeidslisten kan si om kronevirkning. Bare server-verifisert prisvirkning
 * vises som beløp; alt annet er en ærlig tekst. Bruttobeløp brukes aldri.
 */
export function workEffect(it: Pick<WorkItem, "effect_status" | "effect_label" | "impact_nok" | "read_integrity" | "unknown_effect_lines">): WorkEffect {
  if (it.read_integrity === "needs_review") {
    return { kind: "read", label: "Kontroller lesingen", detail: "Linjene må kontrolleres mot originalen før prisvirkning kan beregnes." };
  }
  if (it.effect_status === "verified_price_effect" && it.impact_nok != null && Number.isFinite(it.impact_nok)) {
    return { kind: "verified", label: it.effect_label ?? "Beregnet prisavvik", value: it.impact_nok };
  }
  if (it.effect_status === "not_price_effect") {
    return { kind: "none", label: it.effect_label ?? "Ingen prisvirkning", detail: "Oppgaven påvirker ikke pris." };
  }
  const n = it.unknown_effect_lines ?? 0;
  return { kind: "unknown", label: "Prisvirkning ikke beregnet", detail: n > 0 ? `${n} ${n === 1 ? "linje" : "linjer"} uten sikkert grunnlag.` : "Serveren har ikke beregnet prisvirkning." };
}
