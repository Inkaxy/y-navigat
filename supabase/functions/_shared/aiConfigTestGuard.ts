// Ren kontroll før lagret nøkkel dekrypteres i tilkoblingstesten (ingen I/O; testes i appen).
import { isCatalogModel } from "./aiModelCatalog.ts";

export interface StoredCfg { id: string; provider: string; model: string; updated_at: string }
export interface TestBody { config_id?: unknown; expected_updated_at?: unknown; provider?: unknown; model?: unknown; azure_endpoint?: unknown; azure_deployment?: unknown }
export type GuardResult = { ok: true; model: string } | { ok: false; status: number; error: string };

/** Lagret nøkkel krever eksakt id + uendret updated_at-streng; provider/endepunkt kan ikke overstyres. */
export function guardStoredKeyTest(body: TestBody, cfg: StoredCfg): GuardResult {
  if (typeof body.config_id !== "string" || !body.config_id || typeof body.expected_updated_at !== "string" || !body.expected_updated_at) {
    return { ok: false, status: 400, error: "config_id og expected_updated_at er påkrevd for lagret nøkkel" };
  }
  if (body.config_id !== cfg.id || body.expected_updated_at !== cfg.updated_at) {
    return { ok: false, status: 409, error: "Konfigurasjonen er endret — last siden på nytt" };
  }
  if (body.provider && body.provider !== cfg.provider) return { ok: false, status: 400, error: "Lagret nøkkel kan bare testes mot sin egen leverandør" };
  if (body.azure_endpoint || body.azure_deployment) return { ok: false, status: 400, error: "Endepunkt kan ikke overstyres for lagret nøkkel" };
  const chosen = typeof body.model === "string" && body.model ? body.model : cfg.model;
  if (chosen !== cfg.model && !isCatalogModel(cfg.provider, chosen)) return { ok: false, status: 400, error: "Modellen er ikke tillatt" };
  return { ok: true, model: chosen };
}
