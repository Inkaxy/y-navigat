import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import { allReasons } from "@/fakturaer/lib/reviewReasons";

/**
 * Én tydelig hovedhandling per linjetilstand.
 *
 * Køen hadde tidligere fire likestilte knapper på hver rad. Det gjorde det
 * uklart hva saksbehandleren faktisk skulle gjøre først. Her avgjør vi ÉN
 * hovedhandling; resten blir sekundære valg.
 *
 * Merk: et forslag fra matchemotoren er ALDRI en bekreftet kobling. Derfor
 * heter handlingen «Kontroller AI-forslag», ikke «Godta».
 */
export type PrimaryActionKind = "conflict" | "review_suggestion" | "confirm_link" | "start_price" | "variance";

export interface PrimaryAction {
  kind: PrimaryActionKind;
  label: string;
  /** Kort forklaring — vises som tooltip/hjelpetekst. */
  hint: string;
}

const PRICE_REASONS = new Set([
  "price_variance",
  "agreement_conflict",
  "no_baseline",
  "reference_error",
  "unsupported_currency",
  "start_price_manual_check",
]);

/**
 * `startPriceLineIds` er linjene serveren har svart at kvalifiserer til
 * startpris (`rm_start_price_candidates`). Klienten avgjør aldri dette selv.
 */
export function primaryActionFor(line: ReviewLineRow, startPriceLineIds?: ReadonlySet<string>): PrimaryAction {
  const reasons = allReasons(line);

  if (reasons.includes("sku_collision")) {
    return {
      kind: "conflict",
      label: "Løs konflikt",
      hint: "Varenummeret peker på flere varer. Konflikten må løses før linjen kan kontrolleres.",
    };
  }

  const linked = !!line.raw_material_id;

  if (!linked) {
    const top = line.suggestions?.[0];
    if (top) {
      return {
        kind: "review_suggestion",
        label: "Kontroller AI-forslag",
        hint: "Forslaget er en gjetning fra matchemotoren. Du bekrefter vare og pakning selv.",
      };
    }
    return {
      kind: "confirm_link",
      label: "Bekreft vare og pakning",
      hint: "Linjen er ikke koblet til en vare ennå.",
    };
  }

  if (reasons.includes("unknown_package") || reasons.includes("missing_base_unit")) {
    return {
      kind: "confirm_link",
      label: "Bekreft vare og pakning",
      hint: "Pakningen må bekreftes før prisen kan regnes om til grunnenhet.",
    };
  }

  if (reasons.some((r) => PRICE_REASONS.has(r))) {
    return {
      kind: "variance",
      label: "Se prisavvik",
      hint: "Prisen avviker fra grunnlaget, eller grunnlaget mangler.",
    };
  }

  if (startPriceLineIds?.has(line.id)) {
    return {
      kind: "start_price",
      label: "Bekreft startpris",
      hint: "Første bekreftede kjøpspris hos denne leverandøren kan lagres som startpris.",
    };
  }

  return {
    kind: "confirm_link",
    label: "Bekreft vare og pakning",
    hint: "Kontroller koblingen og pakningen på linjen.",
  };
}
