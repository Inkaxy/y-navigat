// Tolker svaret fra extract-invoice-from-pdf for importen. Ren modul (testes i vitest).
//
// Eldre leser (uten ai_status) tolkes som før. Ny leser skiller AI-feil fra «ingen linjer».
import { AI_FAILURE_PREFIX, classifyAiFailure, type AiFailure, type AiFailureKind } from "../_shared/aiFailure.ts";

export type ExtractionOutcome =
  | { kind: "ai_failed"; failure: AiFailure }
  | { kind: "read"; zeroLines: boolean };

const KINDS: readonly AiFailureKind[] = ["auth", "quota", "unavailable", "network", "timeout", "incomplete", "refusal", "config", "other"];
const SYSTEMIC: readonly AiFailureKind[] = ["auth", "quota", "unavailable", "network", "config"];
const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function parseFailure(v: unknown): AiFailure | null {
  if (!isRec(v) || typeof v.kind !== "string" || !(KINDS as readonly string[]).includes(v.kind)) return null;
  const kind = v.kind as AiFailureKind;
  const message = typeof v.message === "string" && v.message.startsWith(AI_FAILURE_PREFIX) ? v.message.slice(0, 500) : classifyAiFailure("").message;
  return {
    kind,
    systemic: SYSTEMIC.includes(kind),
    httpStatus: typeof v.httpStatus === "number" ? v.httpStatus : null,
    provider: typeof v.provider === "string" ? v.provider : null,
    message,
  };
}

export function extractionOutcome(body: unknown): ExtractionOutcome {
  const b = isRec(body) ? body : {};
  const lines = isRec(b.extracted) && Array.isArray(b.extracted.lines) ? b.extracted.lines : [];
  const status = b.ai_status;
  if (status === "not_configured") return { kind: "ai_failed", failure: classifyAiFailure("ingen aktiv ai") };
  if (status === "failed") return { kind: "ai_failed", failure: parseFailure(b.ai_failure) ?? classifyAiFailure("") };
  return { kind: "read", zeroLines: lines.length === 0 };
}
