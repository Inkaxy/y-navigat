/**
 * Sporing av prisoppslag ved datoendring i kundeordre.
 *
 * Problemet som løses: flere prisoppslag kan være i luften samtidig (rask
 * klikking i datovelgeren). Et gammelt, kansellert oppslag som svarer SIST
 * skal verken skrive priser eller melde at prisene er avklart — ellers åpnes
 * «Lagre» mens den nye datoens pris fortsatt er ukjent.
 *
 * Alle metoder er rene funksjoner av generasjonsnummeret, slik at logikken kan
 * testes uten React.
 */
export interface PricingStatus {
  /** Et prisoppslag for gjeldende dato pågår. */
  pending: boolean;
  /** Siste oppslag for gjeldende dato feilet — prisene er ikke avklart. */
  failed: boolean;
}

export class PricingRequestTracker {
  private generation = 0;
  private current: number | null = null;
  private failed = false;

  /** Starter et nytt oppslag og returnerer generasjonsnummeret. */
  start(): number {
    this.generation += 1;
    this.current = this.generation;
    this.failed = false;
    return this.generation;
  }

  /** Sant bare for det nyeste startede oppslaget. */
  isCurrent(generation: number): boolean {
    return this.current === generation;
  }

  /**
   * Registrerer vellykket svar. Returnerer false (og endrer ingenting) når
   * svaret tilhører et utdatert oppslag.
   */
  succeed(generation: number): boolean {
    if (!this.isCurrent(generation)) return false;
    this.current = null;
    this.failed = false;
    return true;
  }

  /**
   * Registrerer feilet svar. Returnerer false for utdaterte oppslag, slik at
   * en gammel feil ikke sperrer lagring for en nyere, vellykket dato.
   */
  fail(generation: number): boolean {
    if (!this.isCurrent(generation)) return false;
    this.current = null;
    this.failed = true;
    return true;
  }

  /**
   * Forkaster alle pågående oppslag uten å starte et nytt. Brukes når dato går
   * tilbake til den lagrede datoen: da gjenopprettes de avtalte prisene, og
   * svar fra mellomdatoen skal ikke lenger brukes.
   */
  invalidate(): void {
    this.generation += 1;
    this.current = null;
    this.failed = false;
  }

  status(): PricingStatus {
    return { pending: this.current !== null, failed: this.failed };
  }
}

/** Prisene er avklart først når ingenting pågår og siste oppslag gikk bra. */
export function pricesResolved(status: PricingStatus): boolean {
  return !status.pending && !status.failed;
}
