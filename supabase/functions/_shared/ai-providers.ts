// Unified AI provider call for invoice extraction.
// Returns a JSON object parsed from the model's response, plus token usage.

export type AiProvider = "anthropic" | "openai" | "azure_openai";

export interface AiCallParams {
  provider: AiProvider;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
  userText: string;
  // PDF as base64 (no data: prefix)
  pdfBase64?: string;
  // Azure
  azureEndpoint?: string;
  azureDeployment?: string;
}

export interface AiCallResult {
  rawText: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

// Rough cost table USD per 1M tokens (input/output) — updated 2025
const COST_TABLE: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-5": { in: 3, out: 15 },
  "claude-3-5-sonnet-20241022": { in: 3, out: 15 },
  "claude-3-5-haiku-20241022": { in: 0.8, out: 4 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
};

export function estimateCostUsd(model: string, inTok: number | null, outTok: number | null): number | null {
  const cost = COST_TABLE[model];
  if (!cost || inTok == null || outTok == null) return null;
  return ((inTok / 1_000_000) * cost.in) + ((outTok / 1_000_000) * cost.out);
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
  const content: any[] = [];
  if (p.pdfBase64) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: p.pdfBase64 },
    });
  }
  content.push({ type: "text", text: p.userText });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
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
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${text.slice(0, 500)}`);
  const data = JSON.parse(text);
  const raw = data?.content?.[0]?.text ?? "";
  return {
    rawText: raw,
    inputTokens: data?.usage?.input_tokens ?? null,
    outputTokens: data?.usage?.output_tokens ?? null,
  };
}

async function callOpenAi(p: AiCallParams): Promise<AiCallResult> {
  // OpenAI Chat Completions doesn't accept PDFs directly — use Responses API with file input
  const body: any = {
    model: p.model,
    input: [
      { role: "system", content: [{ type: "input_text", text: p.systemPrompt }] },
      {
        role: "user",
        content: [
          ...(p.pdfBase64
            ? [{
                type: "input_file",
                filename: "invoice.pdf",
                file_data: `data:application/pdf;base64,${p.pdfBase64}`,
              }]
            : []),
          { type: "input_text", text: p.userText },
        ],
      },
    ],
    max_output_tokens: p.maxTokens,
    temperature: p.temperature,
  };
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${p.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${text.slice(0, 500)}`);
  const data = JSON.parse(text);
  // Extract text content
  let raw = data?.output_text ?? "";
  if (!raw && Array.isArray(data?.output)) {
    for (const item of data.output) {
      const parts = item?.content ?? [];
      for (const part of parts) {
        if (part?.type === "output_text" && part?.text) raw += part.text;
      }
    }
  }
  return {
    rawText: raw,
    inputTokens: data?.usage?.input_tokens ?? null,
    outputTokens: data?.usage?.output_tokens ?? null,
  };
}

async function callAzureOpenAi(p: AiCallParams): Promise<AiCallResult> {
  if (!p.azureEndpoint || !p.azureDeployment) {
    throw new Error("Azure endpoint og deployment må settes");
  }
  const url = `${p.azureEndpoint.replace(/\/$/, "")}/openai/deployments/${p.azureDeployment}/responses?api-version=2024-12-01-preview`;
  const body: any = {
    input: [
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
    ],
    max_output_tokens: p.maxTokens,
    temperature: p.temperature,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "api-key": p.apiKey, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Azure OpenAI ${res.status}: ${text.slice(0, 500)}`);
  const data = JSON.parse(text);
  let raw = data?.output_text ?? "";
  if (!raw && Array.isArray(data?.output)) {
    for (const item of data.output) {
      const parts = item?.content ?? [];
      for (const part of parts) {
        if (part?.type === "output_text" && part?.text) raw += part.text;
      }
    }
  }
  return {
    rawText: raw,
    inputTokens: data?.usage?.input_tokens ?? null,
    outputTokens: data?.usage?.output_tokens ?? null,
  };
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
