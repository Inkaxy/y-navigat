/** Strenge lesere for `ai-config`-svar (globalt per formål, plattformadmin). Feil blir aldri tom liste. */
export type AiProvider = "anthropic" | "openai" | "azure_openai";
export interface AiConfig {
  id: string; provider: AiProvider; model: string; max_tokens: number; temperature: number; is_active: boolean;
  purpose: string; azure_endpoint: string | null; azure_deployment: string | null; created_at: string; updated_at: string;
}
export interface UsageEntry {
  provider: string; model: string; purpose: string; input_tokens: number | null; output_tokens: number | null;
  estimated_cost_usd: number | null; success: boolean; created_at: string;
}

const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const numOrNull = (v: unknown): number | null => (v == null ? null : typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) ? Number(v) : null);
const PROVIDERS: readonly string[] = ["anthropic", "openai", "azure_openai"];
const isProvider = (v: unknown): v is AiProvider => str(v) && PROVIDERS.includes(v);

export function parseAiConfigs(data: unknown): AiConfig[] {
  if (!obj(data) || !Array.isArray(data.configs)) throw new Error("Uventet svar fra AI-konfigurasjonen.");
  return data.configs.map((c) => {
    if (!obj(c) || !str(c.id) || !isProvider(c.provider) || !str(c.model) || !str(c.purpose) || typeof c.is_active !== "boolean") {
      throw new Error("Uventet konfigurasjonsrad.");
    }
    return {
      id: c.id, provider: c.provider, model: c.model, purpose: c.purpose, is_active: c.is_active,
      max_tokens: numOrNull(c.max_tokens) ?? 2000, temperature: numOrNull(c.temperature) ?? 0.1,
      azure_endpoint: str(c.azure_endpoint) ? c.azure_endpoint : null, azure_deployment: str(c.azure_deployment) ? c.azure_deployment : null,
      created_at: str(c.created_at) ? c.created_at : "", updated_at: str(c.updated_at) ? c.updated_at : "",
    };
  });
}

export function parseAiUsage(data: unknown): UsageEntry[] {
  if (!obj(data) || !Array.isArray(data.entries)) throw new Error("Uventet svar fra bruksoversikten.");
  return data.entries.map((e) => {
    if (!obj(e)) throw new Error("Uventet bruksrad.");
    return {
      provider: str(e.provider) ? e.provider : "", model: str(e.model) ? e.model : "", purpose: str(e.purpose) ? e.purpose : "",
      input_tokens: numOrNull(e.input_tokens), output_tokens: numOrNull(e.output_tokens), estimated_cost_usd: numOrNull(e.estimated_cost_usd),
      success: e.success === true, created_at: str(e.created_at) ? e.created_at : "",
    };
  });
}

/** Lagring returnerer bare `{ id: <ny rad> }` (ingen ok-felt). */
export function parseAiSaveResult(data: unknown): string | null {
  return obj(data) && str(data.id) && /^[0-9a-f-]{36}$/i.test(data.id) && !("error" in data && data.error) ? data.id : null;
}
export function isAiDeleted(data: unknown): boolean {
  return obj(data) && data.ok === true;
}

export interface AiDraft { provider: AiProvider; model: string; maxTokens: string; temperature: string; azureEndpoint: string; azureDeployment: string }
export const aiDraftFrom = (c: AiConfig | null): AiDraft => ({
  provider: c?.provider ?? "anthropic",
  model: c?.model ?? "claude-sonnet-4-5",
  maxTokens: String(c?.max_tokens ?? 2000),
  temperature: String(c?.temperature ?? 0.1).replace(".", ","),
  azureEndpoint: c?.azure_endpoint ?? "",
  azureDeployment: c?.azure_deployment ?? "",
});
export const sameAiDraft = (a: AiDraft, b: AiDraft) =>
  a.provider === b.provider && a.model === b.model && a.maxTokens === b.maxTokens && a.temperature === b.temperature &&
  (a.provider !== "azure_openai" || (a.azureEndpoint === b.azureEndpoint && a.azureDeployment === b.azureDeployment));
