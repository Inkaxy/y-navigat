// «Godta som den er» (20261119_godta_sum): kategorier, streng lesing av svar og tekster. Ren logikk.
export const ACCEPT_CATEGORIES = [
  { id: "avgift", label: "Avgifter eller gebyr som ikke er varelinjer" },
  { id: "pant", label: "Pant" },
  { id: "frakt", label: "Frakt" },
  { id: "avrunding", label: "Øreavrunding" },
  { id: "annet", label: "Annet (skriv begrunnelse)" },
] as const;
export type AcceptCategory = (typeof ACCEPT_CATEGORIES)[number]["id"];

export type SumWriteOutcome =
  | { kind: "ok"; auditId: string | null; replay: boolean }
  | { kind: "avvist"; code: string }
  | { kind: "ukjent" };

const KNOWN = new Set(["finnes_ikke", "endret", "ikke_avvik", "faktura_last", "ingen_linjer", "mva_forhold", "endret_siden", "allerede_angret"]);

/** Bare `ok:true` er utført; kjent avvisning er avvist; alt annet er ukjent utfall (kan gjentas med samme op_id). */
export function parseSumWrite(data: unknown): SumWriteOutcome {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { kind: "ukjent" };
  const o = data as Record<string, unknown>;
  if (o.ok === true && typeof o.invoice_id === "string") {
    return { kind: "ok", auditId: typeof o.audit_id === "string" ? o.audit_id : null, replay: o.replay === true };
  }
  if (o.ok === false && typeof o.code === "string" && KNOWN.has(o.code)) return { kind: "avvist", code: o.code };
  return { kind: "ukjent" };
}

export const ACCEPT_REJECT_TEXT: Record<string, string> = {
  finnes_ikke: "Fakturaen finnes ikke lenger.",
  endret: "Fakturaen er endret siden listen ble hentet. Listen er hentet på nytt – se over og prøv igjen.",
  ikke_avvik: "Summen stemmer allerede. Ingenting er endret.",
  faktura_last: "Fakturaen er låst (avstemt, flagget, holdt utenfor, godkjent eller har ført kost). Ingenting er endret.",
  ingen_linjer: "Fakturaen har ingen linjer. Den må leses først.",
  mva_forhold: "Avviket ligner en mva-feil og kan være en manglende linje. Les fakturaen på nytt eller kontroller mot originalen.",
  endret_siden: "Fakturaen er endret etter at summen ble godtatt, så den kan ikke angres herfra.",
  allerede_angret: "Dette er allerede angret.",
};
export const sumRejectText = (code: string) => ACCEPT_REJECT_TEXT[code] ?? "Serveren avviste handlingen. Ingenting er endret.";

export const canSubmitAccept = (category: AcceptCategory | null, reason: string) =>
  category != null && (category !== "annet" || reason.trim().length >= 3) && reason.trim().length <= 500;
