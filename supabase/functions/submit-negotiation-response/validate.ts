// Ren validering av et leverandørsvar. Ingen databasekall her, slik at reglene
// kan testes direkte.

/**
 * Statuser der leverandøren fortsatt får lov til å svare på en RFQ.
 * «awaiting_confirmation» hører til LIVE-forhandlinger (leverandøren bekrefter
 * det som ble avtalt over bordet, ikke et nytt tilbud) og skal derfor IKKE
 * regnes som en åpen RFQ-status her.
 */
export const OPEN_NEGOTIATION_STATUSES = ["invited", "in_progress"] as const;

export interface NegotiationRow {
  id: string;
  status: string | null;
  response_deadline: string | null;
  negotiation_mode?: string | null;
}

export interface ItemRow {
  id: string;
  negotiation_id: string;
}

export interface ResponseInput {
  negotiation_item_id?: unknown;
}

export type SubmissionRejection =
  | { code: "negotiation_closed"; status: number; message: string }
  | { code: "deadline_passed"; status: number; message: string }
  | { code: "item_not_in_negotiation"; status: number; message: string }
  | { code: "invalid_item"; status: number; message: string };

/**
 * Kontrollerer at forhandlingen er åpen, at fristen ikke er passert og at HVER
 * varelinje hører til nettopp denne forhandlingen. Returnerer `null` når alt er
 * i orden.
 */
export function validateSubmission(args: {
  negotiation: NegotiationRow | null;
  items: ItemRow[];
  responses: ResponseInput[];
  now: Date;
}): SubmissionRejection | null {
  const { negotiation, items, responses, now } = args;

  if (!negotiation || !negotiation.status || !OPEN_NEGOTIATION_STATUSES.includes(negotiation.status as never)) {
    return {
      code: "negotiation_closed",
      status: 409,
      message: "Forhandlingen er ikke åpen for svar.",
    };
  }

  if (negotiation.response_deadline) {
    const deadline = new Date(negotiation.response_deadline);
    // En ugyldig dato skal ikke tolkes som «ingen frist».
    if (Number.isNaN(deadline.getTime())) {
      return { code: "deadline_passed", status: 409, message: "Svarfristen kan ikke leses." };
    }
    if (deadline.getTime() < now.getTime()) {
      return { code: "deadline_passed", status: 409, message: "Svarfristen er passert." };
    }
  }

  const allowed = new Set(items.filter((i) => i.negotiation_id === negotiation.id).map((i) => i.id));
  for (const r of responses) {
    const id = typeof r?.negotiation_item_id === "string" ? r.negotiation_item_id.trim() : "";
    if (!id) {
      return { code: "invalid_item", status: 400, message: "En linje mangler vare-ID." };
    }
    if (!allowed.has(id)) {
      return {
        code: "item_not_in_negotiation",
        status: 403,
        message: "En av varelinjene hører ikke til denne forhandlingen.",
      };
    }
  }

  return null;
}
