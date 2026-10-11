import { ACTION_COPY } from "@/fakturaer/lib/financialPresentation";
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
export function workEffect(it: Pick<WorkItem, "effect_status" | "effect_label" | "impact_nok" | "read_integrity" | "unknown_effect_lines"> & Partial<Pick<WorkItem, "action_required">>): WorkEffect {
  if (it.read_integrity === "needs_review") {
    // Serverens årsak avgjør teksten: kreditt/valuta/prisgrunnlag/kobling er ikke «lesefeil».
    const a = it.action_required && it.action_required !== "review_price" && it.action_required !== "review_invoice" ? it.action_required : "review_reading";
    return { kind: "read", label: ACTION_COPY[a].label, detail: ACTION_COPY[a].detail };
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
