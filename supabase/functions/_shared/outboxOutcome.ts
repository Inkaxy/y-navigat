// Klassifisering av svaret fra microsoft-graph-send for e-postkøen. Ren funksjon.
//  - sent:     2xx med gyldig JSON og success === true.
//  - rejected: kjent avvisning FØR/uten levering (4xx med JSON uten delivery_unknown) → kan prøves igjen.
//  - unknown:  5xx, ugyldig/ikke-suksess-JSON på 2xx, eller delivery_unknown === true. Meldingen kan
//              ha nådd Graph; ingen automatisk ny sending (unngår duplikater).
export type OutboxOutcome = { kind: "sent" } | { kind: "rejected"; error: string } | { kind: "unknown"; error: string };

export const UNKNOWN_NOTE = "Ukjent leveringsutfall. Kontroller Sendte elementer i postkassen før ny sending.";

export function classifyGraphSendResponse(status: number, text: string): OutboxOutcome {
  let parsed: Record<string, unknown> | null = null;
  try {
    const v: unknown = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) parsed = v as Record<string, unknown>;
  } catch (_e) {
    parsed = null;
  }
  const err = typeof parsed?.error === "string" ? parsed.error : `graph-send returnerte ${status}`;
  if (status >= 200 && status < 300) {
    if (parsed && parsed.success === true) return { kind: "sent" };
    return { kind: "unknown", error: `${UNKNOWN_NOTE} (svaret var ikke en gyldig bekreftelse)` };
  }
  if (status >= 500 || parsed?.delivery_unknown === true) return { kind: "unknown", error: `${UNKNOWN_NOTE} (${err.slice(0, 200)})` };
  return { kind: "rejected", error: err };
}
