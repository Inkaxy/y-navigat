// Unified AI provider call (invoice extraction, line suggestions, model eval, …).
// Returns the model's raw text plus token usage.
//
// Bakoverkompatibelt: kallere som ikke sender jsonSchema/reasoningEffort/timeoutMs
// får samme forespørsel som før (temperature sendes, ingen schema). Nye valg:
//  - jsonSchema: OpenAI/Azure Responses «text.format» med strict JSON-schema.
//  - reasoningEffort: settes for resonneringsmodeller (gpt-5*/gpt-6*/o*); da sendes
//    aldri temperature/top_p. gpt-6* får «low» som standard når ingenting er valgt.
//  - timeoutMs: avbryter kallet og gir AiCallError("timeout"). Ingen skjulte nye forsøk.
//  - status «incomplete» og «refusal» gir tydelig AiCallError i stedet for halv tekst.

export type AiProvider = "anthropic" | "openai" | "azure_openai";
export type ReasoningEffort = "none" | "low" | "medium" | "high";

export interface AiJsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

export interface AiCallParams {
  provider: AiProvider;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature?: number;
  systemPrompt: string;
  userText: string;
  // PDF as base64 (no data: prefix)
  pdfBase64?: string;
  // Azure
  azureEndpoint?: string;
  azureDeployment?: string;
  jsonSchema?: AiJsonSchema;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;
}

export interface AiCallResult {
  rawText: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
  status?: string | null;
}

export type AiErrorKind = "refusal" | "incomplete" | "timeout" | "model_unavailable" | "http" | "empty";

export interface AiUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
}

export class AiCallError extends Error {
  kind: AiErrorKind;
  httpStatus: number | null;
  detail: string | null;
  /** Forbruk modellen faktisk rapporterte før feilen (avslag/ufullstendig). Betalte tokens skal ikke mistes i loggen. */
  usage: AiUsage | null;
  constructor(kind: AiErrorKind, message: string, httpStatus: number | null = null, detail: string | null = null, usage: AiUsage | null = null) {
    super(message);
    this.name = "AiCallError";
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.detail = detail;
    this.usage = usage;
  }
}

/** Forbruk fra et AI-kall eller en AiCallError (null når ukjent). */
export function usageOf(x: unknown): AiUsage | null {
  if (x instanceof AiCallError) return x.usage;
  if (typeof x === "object" && x !== null && "inputTokens" in x) {
    const r = x as AiUsage;
    return { inputTokens: r.inputTokens ?? null, outputTokens: r.outputTokens ?? null, cachedInputTokens: r.cachedInputTokens ?? null, reasoningTokens: r.reasoningTokens ?? null };
  }
  return null;
}

/** Versjon av pristabellen. Endres når satsene endres, og følger hvert overslag. */
export const COST_RATE_VERSION = "2026-10-14";

// USD per 1M tokens. `cached` = sats for bufrede inndata-tokens når publisert; uten den regnes bufrede
// tokens til full inndatapris (konservativt overslag). Cache-skriving rapporteres ikke av Responses-API-et
// og er derfor ikke med. Modeller uten kjent pris gir null (= ukjent).
// gpt-6.1-sol / gpt-6-luna: standardsatser fra developers.openai.com/api/docs/models/{gpt-6.1-sol,gpt-6-luna}.md, hentet 14.10.2026.
const COST_TABLE: Record<string, { in: number; out: number; cached?: number; cacheWrite?: number }> = {
  "gpt-6.1-sol": { in: 2, out: 10, cached: 0.1, cacheWrite: 2.5 },
  "gpt-6-luna": { in: 0.1, out: 0.5, cached: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-4-5": { in: 3, out: 15 },
  "claude-3-5-sonnet-20241022": { in: 3, out: 15 },
  "claude-3-5-haiku-20241022": { in: 0.8, out: 4 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
};

/**
 * Anslått kostnad. `cachedTok` er en del av `inTok` (slik Responses rapporterer). Bufrede tokens prises med
 * `cached`-satsen når den er kjent, ellers med full inndatapris. Ukjent modell/forbruk → null.
 */
export function estimateCostUsd(model: string, inTok: number | null, outTok: number | null, cachedTok: number | null = null): number | null {
  const cost = COST_TABLE[model];
  if (!cost || inTok == null || outTok == null) return null;
  const cached = cachedTok != null && cachedTok > 0 && cost.cached != null ? Math.min(cachedTok, inTok) : 0;
  return (((inTok - cached) * cost.in) + (cached * (cost.cached ?? cost.in)) + (outTok * cost.out)) / 1_000_000;
}

/** Om modellens bufrede inndata prises med egen sats (ellers konservativt til full pris). */
export function hasCachedRate(model: string): boolean {
  return COST_TABLE[model]?.cached != null;
}

/** Resonneringsmodeller avviser temperature/top_p. */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|gpt-6|o\d)/i.test(model.trim());
}

/** Effektiv resonneringsinnsats: eksplisitt valg, ellers «low» for gpt-6*, ellers ingen. */
export function effectiveReasoning(model: string, effort: ReasoningEffort | undefined): ReasoningEffort | null {
  if (effort) return effort;
  if (/^gpt-6/i.test(model.trim())) return "low";
  return null;
}

/** Bygger Responses-kroppen (OpenAI og Azure). Ren funksjon — testes i vitest. */
export function buildResponsesBody(p: AiCallParams, includeModel: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (includeModel) body.model = p.model;
  body.input = [
    { role: "system", content: [{ type: "input_text", text: p.systemPrompt }] },
    {
      role: "user",
      content: [
        ...(p.pdfBase64
          ? [{ type: "input_file", filename: "invoice.pdf", file_data: `data:application/pdf;base64,${p.pdfBase64}` }]
          : []),
        { type: "input_text", text: p.userText },
      ],
    },
  ];
  body.max_output_tokens = p.maxTokens;
  const effort = effectiveReasoning(p.model, p.reasoningEffort);
  const reasoningOn = effort != null && effort !== "none";
  if (reasoningOn) {
    body.reasoning = { effort };
  } else {
    if (effort === "none") body.reasoning = { effort: "none" };
    // Bare for ikke-resonnerende kall, og bare når kalleren har sendt en verdi.
    if (typeof p.temperature === "number" && Number.isFinite(p.temperature) && !isReasoningModel(p.model)) {
      body.temperature = p.temperature;
    }
  }
  if (p.jsonSchema) {
    body.text = { format: { type: "json_schema", name: p.jsonSchema.name, schema: p.jsonSchema.schema, strict: true } };
  }
  return body;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Tolker et Responses-svar. Kaster AiCallError ved refusal/incomplete/tomt. */
export function parseResponsesOutput(data: unknown): AiCallResult {
  const d = isRec(data) ? data : {};
  const usage = isRec(d.usage) ? d.usage : {};
  const inDet = isRec(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const outDet = isRec(usage.output_tokens_details) ? usage.output_tokens_details : {};
  const base = {
    inputTokens: intOrNull(usage.input_tokens),
    outputTokens: intOrNull(usage.output_tokens),
    cachedInputTokens: intOrNull(inDet.cached_tokens),
    reasoningTokens: intOrNull(outDet.reasoning_tokens),
    status: typeof d.status === "string" ? d.status : null,
  };
  let raw = typeof d.output_text === "string" ? d.output_text : "";
  let refusal: string | null = null;
  if (Array.isArray(d.output)) {
    let collected = "";
    for (const item of d.output) {
      const parts = isRec(item) && Array.isArray(item.content) ? item.content : [];
      for (const part of parts) {
        if (!isRec(part)) continue;
        if (part.type === "output_text" && typeof part.text === "string") collected += part.text;
        if (part.type === "refusal") refusal = typeof part.refusal === "string" ? part.refusal : "avslått";
      }
    }
    if (!raw) raw = collected;
  }
  if (refusal != null) {
    throw new AiCallError("refusal", `Modellen avslo forespørselen: ${refusal.slice(0, 200)}`, null, null, base);
  }
  if (base.status === "incomplete") {
    const reason = isRec(d.incomplete_details) && typeof d.incomplete_details.reason === "string" ? d.incomplete_details.reason : "ukjent";
    throw new AiCallError("incomplete", `Svaret ble ufullstendig (${reason})`, null, reason, base);
  }
  if (!raw.trim()) throw new AiCallError("empty", "Modellen returnerte tomt svar", null, null, base);
  return { rawText: raw, ...base };
}

/** Klassifiserer HTTP-feil. 404/model_not_found = modellen er ikke tilgjengelig for nøkkelen. */
export function classifyHttpError(provider: string, status: number, text: string): AiCallError {
  let code = "";
  try { const j = JSON.parse(text); code = String(j?.error?.code ?? j?.error?.type ?? ""); } catch { /* ikke JSON */ }
  const unavailable = status === 404 || code === "model_not_found" || /model.*(does not exist|not found|do not have access)/i.test(text);
  return new AiCallError(unavailable ? "model_unavailable" : "http", `${provider} ${status}: ${text.slice(0, 500)}`, status, code || null);
}

/** Fetch + lesing av hele svarkroppen under SAMME tidsfrist (ikke bare til headerne kommer). */
export async function timedFetch(url: string, init: RequestInit, timeoutMs: number | undefined): Promise<{ res: Response; text: string }> {
  if (!timeoutMs) { const res = await fetch(url, init); return { res, text: await res.text() }; }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    const text = await res.text();
    return { res, text };
  } catch (e) {
    if (ctl.signal.aborted) throw new AiCallError("timeout", `Modellen svarte ikke innen ${Math.round(timeoutMs / 1000)} s`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export async function callAi(p: AiCallParams): Promise<AiCallResult> {
  // Trim whitespace/newlines som ofte sniker seg inn ved copy-paste
  p = { ...p, apiKey: (p.apiKey ?? "").trim() };
  if (!p.apiKey) throw new Error("API-key er tom");
  if (p.provider === "anthropic") return callAnthropic(p);
  if (p.provider === "openai") return callOpenAi(p);
  if (p.provider === "azure_openai") return callAzureOpenAi(p);
  throw new Error(`Unsupported provider: ${p.provider}`);
}

async function callAnthropic(p: AiCallParams): Promise<AiCallResult> {
  const content: unknown[] = [];
  if (p.pdfBase64) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: p.pdfBase64 },
    });
  }
  content.push({ type: "text", text: p.userText });

  const { res, text } = await timedFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": p.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: p.model,
      max_tokens: p.maxTokens,
      temperature: p.temperature,
      system: p.systemPrompt,
      messages: [{ role: "user", content }],
    }),
  }, p.timeoutMs);
  if (!res.ok) throw classifyHttpError("Anthropic", res.status, text);
  const data = JSON.parse(text);
  const raw = data?.content?.[0]?.text ?? "";
  return {
    rawText: raw,
    inputTokens: data?.usage?.input_tokens ?? null,
    outputTokens: data?.usage?.output_tokens ?? null,
  };
}

async function callOpenAi(p: AiCallParams): Promise<AiCallResult> {
  // Responses API (støtter PDF som input_file og strict JSON-schema).
  const { res, text } = await timedFetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${p.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(buildResponsesBody(p, true)),
  }, p.timeoutMs);
  if (!res.ok) throw classifyHttpError("OpenAI", res.status, text);
  return parseResponsesOutput(JSON.parse(text));
}

async function callAzureOpenAi(p: AiCallParams): Promise<AiCallResult> {
  if (!p.azureEndpoint || !p.azureDeployment) {
    throw new Error("Azure endpoint og deployment må settes");
  }
  const url = `${p.azureEndpoint.replace(/\/$/, "")}/openai/deployments/${p.azureDeployment}/responses?api-version=2024-12-01-preview`;
  const { res, text } = await timedFetch(url, {
    method: "POST",
    headers: { "api-key": p.apiKey, "content-type": "application/json" },
    body: JSON.stringify(buildResponsesBody(p, false)),
  }, p.timeoutMs);
  if (!res.ok) throw classifyHttpError("Azure OpenAI", res.status, text);
  return parseResponsesOutput(JSON.parse(text));
}

export function extractJson(raw: string): any {
  // Tolerant JSON extraction — strip code fences, find first {...} block
  let t = raw.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```$/m, "").trim();
  }
  // Try direct parse first
  try { return JSON.parse(t); } catch { /* continue */ }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch { /* */ }
  }
  throw new Error("Klarte ikke å parse JSON-respons fra AI");
}
