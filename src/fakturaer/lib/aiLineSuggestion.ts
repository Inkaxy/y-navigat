import { supabase } from "@/integrations/supabase/client";

/**
 * AI-forslag for én fakturalinje — hentes kun når saksbehandleren ber om det.
 *
 * Forslaget er en gjetning fra en språkmodell. Det kobler ingenting, bekrefter
 * ingenting og godkjenner ingenting; mennesket bekrefter i skuffen som før.
 * Mangler nøkkel, eller feiler/tar modellen for lang tid, faller vi tilbake til
 * ordinær manuell arbeidsflyt uten feilmelding i ansiktet på brukeren.
 */
export interface AiLineSuggestion {
  rawMaterialId: string | null;
  confidence: number | null;
  packageSize: number | null;
  packageUnit: string | null;
  explanation: string | null;
  uncertainties: string[];
  model: string;
}

export type AiSuggestionReason = "ingen_kandidater" | "ingen_ai_konfigurasjon" | "ai_feilet" | "tidsavbrudd";

export interface AiLineSuggestionResult {
  suggestion: AiLineSuggestion | null;
  reason: AiSuggestionReason | null;
}

export const AI_REASON_LABELS: Record<AiSuggestionReason, string> = {
  ingen_kandidater: "Fant ingen kandidatvarer å foreslå blant. Søk fram varen manuelt.",
  ingen_ai_konfigurasjon: "AI-hjelp er ikke satt opp. Fortsett manuelt som før.",
  ai_feilet: "AI-hjelpen svarte ikke. Fortsett manuelt som før.",
  tidsavbrudd: "AI-hjelpen brukte for lang tid. Fortsett manuelt som før.",
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function fetchAiLineSuggestion(args: {
  invoiceLineId: string;
  candidateIds?: string[];
  timeoutMs?: number;
}): Promise<AiLineSuggestionResult> {
  const timeoutMs = args.timeoutMs ?? 30_000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<AiLineSuggestionResult>((resolve) => {
    timer = setTimeout(() => resolve({ suggestion: null, reason: "tidsavbrudd" }), timeoutMs);
  });

  const call = (async (): Promise<AiLineSuggestionResult> => {
    const { data, error } = await supabase.functions.invoke("suggest-invoice-line-match", {
      body: { invoice_line_id: args.invoiceLineId, candidate_ids: args.candidateIds ?? null },
    });
    if (error) return { suggestion: null, reason: "ai_feilet" };
    const o = (data ?? {}) as Record<string, unknown>;
    const raw = o.suggestion as Record<string, unknown> | null | undefined;
    if (!raw) {
      const reason = str(o.reason);
      const known: AiSuggestionReason[] = ["ingen_kandidater", "ingen_ai_konfigurasjon", "ai_feilet"];
      return {
        suggestion: null,
        reason: known.includes(reason as AiSuggestionReason) ? (reason as AiSuggestionReason) : "ai_feilet",
      };
    }
    return {
      suggestion: {
        rawMaterialId: str(raw.raw_material_id),
        confidence: num(raw.confidence),
        packageSize: num(raw.package_size),
        packageUnit: str(raw.package_unit),
        explanation: str(raw.explanation),
        uncertainties: Array.isArray(raw.uncertainties)
          ? (raw.uncertainties as unknown[]).filter((u): u is string => typeof u === "string")
          : [],
        model: str(raw.model) ?? "",
      },
      reason: null,
    };
  })();

  try {
    return await Promise.race([call, timeout]);
  } catch {
    return { suggestion: null, reason: "ai_feilet" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
