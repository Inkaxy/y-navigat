/**
 * «Hold utenfor råvarebehandling»: varig, serverstyrt utelatelse av et helt dokument eller én linje
 * (`rm_set_invoice_exclusion` / `rm_reopen_invoice_exclusion`). Ikke avstemming, ikke godkjenning.
 * Svar leses strengt: bare `ok:true` er utført; alt uklart er ukjent utfall.
 */
import type { Json } from "@/integrations/supabase/types";
import { bool, isObj, num, str } from "@/fakturaer/lib/parseRpcJson";

export type ExclusionScope = "invoice" | "line";
export type ExclusionCategory = "erstatning_produksjonstap" | "annet";

export const EXCLUSION_CATEGORY_LABEL: Record<ExclusionCategory, string> = {
  erstatning_produksjonstap: "Erstatning / produksjonstap",
  annet: "Annet",
};
export const parseExclusionCategory = (v: string | null | undefined): ExclusionCategory | null =>
  v === "erstatning_produksjonstap" || v === "annet" ? v : null;

export const MIN_REASON = 5;
export const MAX_REASON = 500;

export type BlockedLine = { lineId: string; lineNumber: number | null; blocker: string };
export type ExclusionResult =
  | { kind: "ok"; already: boolean; updatedAt: string | null; lines: number | null }
  | { kind: "rejected"; error: string; blocked: BlockedLine[] }
  | { kind: "unknown" };

export function parseExclusionResult(data: Json | null | undefined): ExclusionResult {
  if (!isObj(data)) return { kind: "unknown" };
  const ok = bool(data, "ok");
  if (ok === true) return { kind: "ok", already: bool(data, "already") === true, updatedAt: str(data, "updated_at"), lines: num(data, "lines") };
  if (ok === false) {
    const error = str(data, "error");
    if (!error) return { kind: "unknown" };
    const raw = Array.isArray(data.blocked_lines) ? data.blocked_lines : [];
    const blocked: BlockedLine[] = [];
    for (const b of raw) {
      if (!isObj(b)) continue;
      const lineId = str(b, "line_id"); const blocker = str(b, "blocker");
      if (lineId && blocker) blocked.push({ lineId, lineNumber: num(b, "line_number"), blocker });
    }
    return { kind: "rejected", error, blocked };
  }
  return { kind: "unknown" };
}

const BLOCKER_LABEL: Record<string, string> = {
  kostpris_fort: "kostpris er allerede ført fra linjen",
  lagerbevegelse: "linjen har lagerbevegelse",
  varemottak: "linjen har registrert varemottak",
  lagerparti: "linjen har lagerparti",
  prisobservasjon: "linjen er en aktiv prisobservasjon",
};
const ERROR_LABEL: Record<string, string> = {
  versjon_endret: "Fakturaen eller linjen er endret siden du åpnet den. Last inn på nytt og prøv igjen.",
  begrunnelse_mangler: `Skriv en begrunnelse på minst ${MIN_REASON} tegn.`,
  ugyldig_arsak: "Velg en årsak.",
  ugyldig_omfang: "Velg om det gjelder linjen eller hele dokumentet.",
  allerede_holdt_utenfor: "Dette er allerede holdt utenfor råvarebehandling.",
  faktura_holdt_utenfor: "Hele dokumentet er holdt utenfor. Gjenåpne dokumentet i stedet.",
  faktura_avstemt: "Fakturaen er avstemt og kan ikke holdes utenfor.",
  faktura_godkjent: "Fakturaen er internt godkjent og kan ikke holdes utenfor.",
  linje_finnes_ikke: "Fant ikke linjen på denne fakturaen.",
  op_mangler: "Teknisk feil. Lukk og åpne dialogen på nytt.",
};

export function exclusionErrorText(r: Extract<ExclusionResult, { kind: "rejected" }>): string {
  if (r.error === "reversering_kreves") {
    const parts = r.blocked.map((b) => `linje ${b.lineNumber ?? "?"}: ${BLOCKER_LABEL[b.blocker] ?? "har ført effekt"}`);
    return `Kan ikke holdes utenfor før dette er reversert (${parts.join("; ")}). Ingenting er endret.`;
  }
  return ERROR_LABEL[r.error] ?? "Ble avvist. Ingenting er endret.";
}

/** Er dokumentet eller linjen holdt utenfor? Leses fra feltene fakturadetaljen allerede henter (`select *`). */
export type ExclusionFacts = { excluded_at?: string | null; excluded_by?: string | null; exclusion_category?: string | null; exclusion_reason?: string | null };
export const isExcluded = (f: ExclusionFacts | null | undefined): boolean => !!f?.excluded_at;
