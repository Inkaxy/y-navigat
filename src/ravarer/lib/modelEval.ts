import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const EVAL_MODEL_OPTIONS = [
  { value: "gpt-4o", label: "gpt-4o (dagens)" },
  { value: "gpt-6.1-sol", label: "gpt-6.1-sol (kandidat)" },
  { value: "gpt-6-luna", label: "gpt-6-luna (kandidat)" },
] as const;
export const MAX_EVAL_INVOICES = 6;

export interface EvalOutcome {
  invoiceId: string;
  invoiceNumber: string | null;
  model: string;
  status: string;
  statusLabel: string;
  error: string | null;
  usage: { input: number | null; output: number | null; cached: number | null; reasoning: number | null };
  costUsd: number | null;
  latencyMs: number | null;
  lineCount: number | null;
  storedLineCount: number | null;
  checkCount: number | null;
  checkCounts: Record<string, number>;
  raw: unknown;
}

const STATUS_LABELS: Record<string, string> = {
  ok: "Lest", model_unavailable: "Modellen er ikke tilgjengelig for nøkkelen", timeout: "Tidsavbrudd",
  refusal: "Modellen avslo", incomplete: "Ufullstendig svar", invalid_json: "Ugyldig svar", empty: "Tomt svar",
  http: "Feil fra leverandøren", forbidden: "Ingen tilgang", unauthorized: "Ikke innlogget", duplicate: "Nettopp kjørt",
  daily_limit: "Døgntak nådd", document_missing: "Ingen original-PDF", document_changed: "Originalen ble endret",
  no_credential: "Ingen OpenAI-nøkkel", invalid_model: "Modell ikke tillatt", nettverk: "Ukjent utfall (nettverk)",
};

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Streng tolkning av evalsvaret. Ukjent form er feil, aldri «ok». */
export function parseEvalOutcome(data: unknown, invoiceId: string, model: string): EvalOutcome {
  const o = isRec(data) ? data : {};
  const errObj = isRec(o.error) ? o.error : null;
  const usage = isRec(o.usage) ? o.usage : {};
  const parsed = isRec(o.parsed) ? o.parsed : null;
  const status = errObj ? (str(errObj.code) ?? "http") : (str(o.status) ?? "invalid_json");
  const counts: Record<string, number> = {};
  if (isRec(o.check_counts)) for (const [k, v] of Object.entries(o.check_counts)) { const n = num(v); if (n != null) counts[k] = n; }
  return {
    invoiceId, invoiceNumber: str(o.invoice_number), model,
    status, statusLabel: STATUS_LABELS[status] ?? "Ukjent status",
    error: errObj ? str(errObj.message) : str(o.error),
    usage: { input: num(usage.input_tokens), output: num(usage.output_tokens), cached: num(usage.cached_input_tokens), reasoning: num(usage.reasoning_tokens) },
    costUsd: num(o.estimated_cost_usd),
    latencyMs: num(o.latency_ms),
    lineCount: parsed && Array.isArray(parsed.lines) ? parsed.lines.length : null,
    storedLineCount: num(o.stored_line_count),
    checkCount: Array.isArray(o.checks) && !errObj ? o.checks.length : null,
    checkCounts: counts,
    raw: data,
  };
}

export async function invokeModelEval(invoiceId: string, model: string): Promise<EvalOutcome> {
  const { data, error } = await supabase.functions.invoke("invoice-model-eval", { body: { invoice_id: invoiceId, model } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body: unknown = await error.context.json().catch(() => null);
      return parseEvalOutcome(body ?? { error: { code: "http", message: "Ukjent feil" } }, invoiceId, model);
    }
    return parseEvalOutcome({ error: { code: "nettverk", message: "Svaret kom ikke fram" } }, invoiceId, model);
  }
  return parseEvalOutcome(data, invoiceId, model);
}
