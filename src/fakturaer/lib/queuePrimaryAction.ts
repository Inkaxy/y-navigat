import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import { allReasons } from "@/fakturaer/lib/reviewReasons";

/**
 * Én tydelig hovedhandling per linjetilstand.
 *
 * Køen hadde tidligere fire likestilte knapper på hver rad. Det gjorde det
 * uklart hva saksbehandleren faktisk skulle gjøre først. Her avgjør vi ÉN
 * hovedhandling; resten blir sekundære valg.
 *
 * Merk: matchemotoren er deterministisk (varenummer, alias, navnelikhet). Et
 * forslag derfra er en regelbasert gjetning — ikke et AI-forslag og aldri en
 * bekreftet kobling. Bare forslag som faktisk kommer fra en språkmodell
 * merkes «AI-forslag», og det skjer i skuffen der modellsvaret vises.
 */
export type PrimaryActionKind = "conflict" | "review_suggestion" | "confirm_link" | "start_price" | "variance";

export interface PrimaryAction {
  kind: PrimaryActionKind;
  label: string;
  /** Kort forklaring — vises som tooltip/hjelpetekst. */
  hint: string;
}

/** Årsaker som handler om selve prisen, ikke om kobling, mengde eller pakning. */
const PRICE_REASONS: ReadonlySet<string> = new Set([
  "price_variance",
  "price_increase",
  "price_drop",
  "agreement_conflict",
  "no_baseline",
  "price_reference_error",
  "unsupported_currency",
  "start_price_manual_check",
  "no_automatic_basis",
]);

/**
 * Årsaker som må løses FØR prisen betyr noe: uten riktig beløp, mengde,
 * pakning eller grunnenhet er kiloprisen ikke et tall man kan diskutere.
 */
const BLOCKING_DATA_REASONS: ReadonlySet<string> = new Set([
  "extraction_unresolved",
  "extraction_issue",
  "zero_quantity",
  "unknown_package_size",
  "missing_base_unit",
  "uncertain_cost",
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

  if (reasons.includes("recalculation_pending")) {
    return {
      kind: "confirm_link",
      label: "Kontroller linjen",
      hint: "Linjen er nettopp endret og må beregnes på nytt før den kan avstemmes.",
    };
  }

  const linked = !!line.raw_material_id;
  // En automatisk kobling med lav tillit er IKKE en bekreftet kobling, selv om
  // linjen har en vare på seg.
  const confirmedLink = linked && line.match_confidence === "manual";

  // 1) Uttrekk, mengde, pakning og grunnenhet først.
  if (reasons.some((r) => BLOCKING_DATA_REASONS.has(r))) {
    return {
      kind: "confirm_link",
      label: linked ? "Bekreft pakning og mengde" : "Bekreft vare og pakning",
      hint: "Beløp, mengde, pakning eller grunnenhet må avklares før prisen kan regnes om til grunnenhet.",
    };
  }

  // 2) Deretter forslaget som venter på en menneskelig vurdering.
  if (!confirmedLink) {
    const hasSuggestion = (line.suggestions?.length ?? 0) > 0;
    if (hasSuggestion || linked) {
      return {
        kind: "review_suggestion",
        label: "Kontroller forslag",
        hint: linked
          ? "Matchemotoren har koblet linjen automatisk med lav tillit. Du bekrefter vare og pakning selv."
          : "Forslaget er en regelbasert gjetning fra matchemotoren. Du bekrefter vare og pakning selv.",
      };
    }
    return {
      kind: "confirm_link",
      label: "Bekreft vare og pakning",
      hint: "Linjen er ikke koblet til en vare ennå.",
    };
  }

  // 3) Til slutt prisen.
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
    label: "Kontroller linjen",
    hint: "Kontroller koblingen og pakningen på linjen.",
  };
}
