// Ren logikk for hva som skal skje når linjeuthenting feiler for en faktura —
// trukket ut slik at den kan testes uten nettverk eller database.

export interface FailurePlanInput {
  attempts: number;
  message: string;
  status: string | null;
  pdfFail: boolean;
  /**
   * Feilen gjelder AI-tjenesten (nøkkel/kvote/nede/nettverk/oppsett), ikke fakturaen. Forsøket skal ikke
   * telles: patch.release_attempt=true (brukes av rm_fail_invoice_line_extraction etter PENDING-SQL
   * 20261113_line_extraction_release_requeue; eldre funksjon ignorerer feltet og teller som før).
   */
  aiSystemic?: boolean;
}

export interface FailurePlanResult {
  patch: Record<string, unknown>;
  gaveOpp: boolean;
}

/** Maks antall forsøk før en faktura gis opp og må gjennomgås manuelt. */
export const MAX_LINE_EXTRACTION_ATTEMPTS = 3;

/**
 * Bygger oppdateringen som skal lagres på fakturaen etter et feilet forsøk.
 * `attempts` er tellerverdien FØR dette forsøket (dvs. inv.line_extraction_attempts),
 * og representerer også antallet etter dette forsøket siden kø-RPC-en øker den ved claim.
 */
export function planLineExtractionFailure(input: FailurePlanInput): FailurePlanResult {
  const { attempts, message, status, pdfFail } = input;
  const now = new Date().toISOString();

  if (input.aiSystemic === true) {
    // Fakturaen gis ikke opp på grunn av tjenesten: den blir liggende i køen (eller «failed» med AI-tekst
    // når telleren allerede er brukt opp, slik at gjenlesingen kan legge den tilbake).
    const exhausted = attempts >= MAX_LINE_EXTRACTION_ATTEMPTS;
    return {
      patch: {
        line_extraction_status: exhausted ? "failed" : "pending",
        line_extraction_error: message,
        line_extraction_at: now,
        release_attempt: true,
      },
      gaveOpp: false,
    };
  }

  if (attempts >= MAX_LINE_EXTRACTION_ATTEMPTS) {
    const patch: Record<string, unknown> = {
      line_extraction_status: "failed",
      line_extraction_error: message,
      line_extraction_at: now,
      status: status === "imported" ? "needs_review" : status,
    };
    if (pdfFail) patch.pdf_status = "failed";
    return { patch, gaveOpp: true };
  }

  return {
    patch: {
      line_extraction_status: "pending",
      line_extraction_error: `Forsøk ${attempts}/${MAX_LINE_EXTRACTION_ATTEMPTS}: ${message}`,
      line_extraction_at: now,
    },
    gaveOpp: false,
  };
}
