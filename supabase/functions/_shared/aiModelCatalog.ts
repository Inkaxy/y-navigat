// Felles modellkatalog for innstillinger, tilkoblingstest, modellsammenligning og servervalidering.
// Ren data — importeres både av edge-funksjoner og av appen. Status er IKKE en kvalitetspåstand:
// «kandidat» betyr tilgjengelighetstestet, ikke kvalitetssikret på fakturaer.

export type CatalogProvider = "anthropic" | "openai" | "azure_openai";
export type ModelStatus = "etablert" | "kandidat";

export interface CatalogModel {
  provider: CatalogProvider;
  id: string;
  label: string;
  status: ModelStatus;
  /** Resonneringsmodell: bruker ikke temperatur/top_p. */
  reasoning: boolean;
}

export const AI_MODEL_CATALOG: readonly CatalogModel[] = [
  { provider: "anthropic", id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", status: "etablert", reasoning: false },
  { provider: "anthropic", id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", status: "etablert", reasoning: false },
  { provider: "anthropic", id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", status: "etablert", reasoning: false },
  { provider: "openai", id: "gpt-4o", label: "GPT-4o", status: "etablert", reasoning: false },
  { provider: "openai", id: "gpt-4o-mini", label: "GPT-4o mini", status: "etablert", reasoning: false },
  { provider: "openai", id: "gpt-4.1", label: "GPT-4.1", status: "etablert", reasoning: false },
  { provider: "openai", id: "gpt-4.1-mini", label: "GPT-4.1 mini", status: "etablert", reasoning: false },
  { provider: "openai", id: "gpt-6.1-sol", label: "GPT-6.1 Sol", status: "kandidat", reasoning: true },
  { provider: "openai", id: "gpt-6-luna", label: "GPT-6 Luna", status: "kandidat", reasoning: true },
  { provider: "azure_openai", id: "gpt-4o", label: "GPT-4o (Azure deployment)", status: "etablert", reasoning: false },
  { provider: "azure_openai", id: "gpt-4o-mini", label: "GPT-4o mini (Azure deployment)", status: "etablert", reasoning: false },
];

export function catalogModelsFor(provider: string): CatalogModel[] {
  return AI_MODEL_CATALOG.filter((m) => m.provider === provider);
}

/** Streng allowlist: bare katalogens modeller for nøyaktig denne provideren. */
export function isCatalogModel(provider: unknown, model: unknown): boolean {
  return typeof provider === "string" && typeof model === "string" && AI_MODEL_CATALOG.some((m) => m.provider === provider && m.id === model);
}

export function catalogEntry(provider: string, model: string): CatalogModel | null {
  return AI_MODEL_CATALOG.find((m) => m.provider === provider && m.id === model) ?? null;
}

export const SETTINGS_LIMITS = { minTokens: 256, maxTokens: 32000, minTemp: 0, maxTemp: 2 } as const;

/** Validerer modell/grenser for update_settings. null = gyldig, ellers norsk feilmelding. */
export function validateModelSettings(provider: string, model: unknown, maxTokens: unknown, temperature: unknown): string | null {
  if (!isCatalogModel(provider, model)) return "Modellen er ikke tillatt for denne leverandøren";
  if (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens < SETTINGS_LIMITS.minTokens || maxTokens > SETTINGS_LIMITS.maxTokens) {
    return `Maks tokens må være et heltall mellom ${SETTINGS_LIMITS.minTokens} og ${SETTINGS_LIMITS.maxTokens}`;
  }
  if (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature < SETTINGS_LIMITS.minTemp || temperature > SETTINGS_LIMITS.maxTemp) {
    return "Temperatur må være mellom 0 og 2";
  }
  return null;
}
