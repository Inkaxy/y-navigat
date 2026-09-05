/**
 * Kundekontekst for ordreregistrering — kredittstopp, kundestatus og leveransepauser.
 *
 * Reglene er samlet her slik at Ny ordre og kundeordre-panelet blokkerer og
 * advarer likt, og slik at de kan testes uten UI.
 */

/** Prefiks som brukes i ordrens interne notat når kredittstopp overstyres. */
export const CREDIT_OVERRIDE_NOTE_PREFIX = "Kredittstopp overstyrt:";

/** Minste lengde på begrunnelsen ved overstyring av kredittstopp. */
export const CREDIT_OVERRIDE_MIN_LENGTH = 10;

export function isValidCreditOverrideReason(reason: string | null | undefined): boolean {
  return (reason ?? "").trim().length >= CREDIT_OVERRIDE_MIN_LENGTH;
}

export type CustomerContextInput = {
  /** Kunden står i kredittstopp. */
  creditHold: boolean;
  creditHoldReason?: string | null;
  /** Begrunnelse operatøren har gitt for å overstyre kredittstoppen. */
  creditOverrideReason?: string | null;
  /** Har brukeren skriverettigheter i Ordre (kan overstyre)? */
  canOverrideCreditHold?: boolean;
  /** Kundens status i kunderegisteret, f.eks. «active», «inactive». */
  status?: string | null;
  /** Aktiv leveransepause for valgt dato/tur, hvis noen. */
  pause?: { reason: string | null; notes: string | null } | null;
};

export type CustomerContextResult = {
  /** Lagring skal blokkeres. */
  blocked: boolean;
  /** Kort norsk melding når lagring er blokkert. */
  blockMessage: string | null;
  /** Advarsler som skal vises, men som ikke blokkerer lagring. */
  warnings: string[];
};

/** Norsk etikett for kundestatus. */
export function customerStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "active":
      return "Aktiv";
    case "inactive":
      return "Inaktiv";
    case "blocked":
      return "Sperret";
    case "prospect":
      return "Prospekt";
    default:
      return status ?? "Ukjent";
  }
}

/** Vurderer om ordren kan lagres for denne kunden, og hvilke advarsler som gjelder. */
export function evaluateCustomerContext(input: CustomerContextInput): CustomerContextResult {
  const warnings: string[] = [];

  if (input.status && input.status !== "active") {
    warnings.push(`Kunden er ikke aktiv (${customerStatusLabel(input.status)}).`);
  }
  if (input.pause) {
    const detail = input.pause.reason?.trim() || input.pause.notes?.trim();
    warnings.push(
      detail
        ? `Kunden har leveransepause på valgt dato: ${detail}`
        : "Kunden har leveransepause på valgt dato.",
    );
  }

  if (input.creditHold) {
    const overridden =
      input.canOverrideCreditHold === true && isValidCreditOverrideReason(input.creditOverrideReason);
    if (!overridden) {
      const reason = input.creditHoldReason?.trim();
      return {
        blocked: true,
        blockMessage: reason
          ? `Kunden står i kredittstopp: ${reason}`
          : "Kunden står i kredittstopp.",
        warnings,
      };
    }
    warnings.push("Kredittstopp er overstyrt med begrunnelse.");
  }

  return { blocked: false, blockMessage: null, warnings };
}

/** Legger begrunnelsen inn i ordrens interne notat uten å miste eksisterende tekst. */
export function withCreditOverrideNote(notes: string, reason: string): string {
  const line = `${CREDIT_OVERRIDE_NOTE_PREFIX} ${reason.trim()}`;
  const rest = (notes ?? "")
    .split("\n")
    .filter((l) => !l.trim().startsWith(CREDIT_OVERRIDE_NOTE_PREFIX))
    .join("\n")
    .trim();
  return rest ? `${line}\n${rest}` : line;
}

/** Ukedagsnavn for ISO-ukedag 1–7. */
export const ISO_WEEKDAY_LABEL: Record<number, string> = {
  1: "Man",
  2: "Tir",
  3: "Ons",
  4: "Tor",
  5: "Fre",
  6: "Lør",
  7: "Søn",
};
