/**
 * Portvakt for etikettutskrift.
 *
 * Utskrift og PDF skal aldri slippe gjennom på et ufullstendig grunnlag.
 * Tidligere ble manglende svar fra `resolve_label_data` lest som «ingen
 * mangler», slik at en etikett uten deklarasjonskontroll kunne skrives ut.
 * Her samles alle grunnene til å vente eller sperre ett sted, slik at de kan
 * testes uten å rendre dialogen.
 */

export type LabelGateStatus = "loading" | "error" | "no_profile" | "missing_data" | "blocked" | "ok";

export interface LabelGateInput {
  /** Har varen en etikettprofil? Uten profil vet vi ikke hvilke felt som kreves. */
  hasProfile: boolean;
  /** Laster deklarasjonskontrollen fortsatt? */
  isLoading: boolean;
  /** Feilet oppslaget mot `resolve_label_data`? */
  isError: boolean;
  /** Ordrelinjene kontrollen må dekke. */
  requiredOrderLineIds: string[];
  /** Ordrelinjer som faktisk har en rad i svaret. */
  resolvedOrderLineIds: string[];
  /** Antall kritiske mangler (matsikkerhet). */
  criticalMissingCount: number;
  /**
   * Etiketter som skal skrives ut uten at de kan knyttes til en ordrelinje.
   * Da finnes det ingen deklarasjonskontroll å støtte seg på, og utskriften
   * sperres i stedet for å godkjennes stilltiende.
   */
  unverifiableCount?: number;
}

export interface LabelGateResult {
  status: LabelGateStatus;
  /** Kan brukeren gå videre til PDF/utskrift? */
  canPrint: boolean;
  /** Norsk forklaring til bruker. Null når alt er i orden. */
  reason: string | null;
  /** Skal «Prøv igjen» vises? */
  retryable: boolean;
}

export function evaluateLabelPrintGate(input: LabelGateInput): LabelGateResult {
  if (input.isLoading) {
    return {
      status: "loading",
      canPrint: false,
      reason: "Kontrollerer deklarasjonsdata …",
      retryable: false,
    };
  }
  if (input.isError) {
    return {
      status: "error",
      canPrint: false,
      reason:
        "Kunne ikke hente deklarasjonsdata. Utskrift er sperret til kontrollen er gjennomført.",
      retryable: true,
    };
  }
  if (!input.hasProfile) {
    return {
      status: "no_profile",
      canPrint: false,
      reason: "Varen mangler etikettprofil — sett profil før utskrift.",
      retryable: false,
    };
  }

  if (input.requiredOrderLineIds.length === 0 && (input.unverifiableCount ?? 0) === 0) {
    return {
      status: "missing_data",
      canPrint: false,
      reason:
        "Ingen etiketter med deklarasjonsgrunnlag å skrive ut. Utskrift er sperret.",
      retryable: false,
    };
  }

  const resolved = new Set(input.resolvedOrderLineIds);
  const mangler = input.requiredOrderLineIds.filter((id) => id && !resolved.has(id));
  if (mangler.length > 0) {
    return {
      status: "missing_data",
      canPrint: false,
      reason:
        mangler.length === 1
          ? "Deklarasjonskontrollen mangler svar for én ordrelinje. Utskrift er sperret."
          : `Deklarasjonskontrollen mangler svar for ${mangler.length} ordrelinjer. Utskrift er sperret.`,
      retryable: true,
    };
  }

  if ((input.unverifiableCount ?? 0) > 0) {
    return {
      status: "missing_data",
      canPrint: false,
      reason:
        "Etiketten kan ikke knyttes til en ordrelinje, så deklarasjonen kan ikke kontrolleres. Utskrift er sperret.",
      retryable: false,
    };
  }

  if (input.criticalMissingCount > 0) {
    return {
      status: "blocked",
      canPrint: false,
      reason: "Kan ikke skrives ut — kritiske deklarasjonsdata mangler.",
      retryable: false,
    };
  }

  return { status: "ok", canPrint: true, reason: null, retryable: false };
}
