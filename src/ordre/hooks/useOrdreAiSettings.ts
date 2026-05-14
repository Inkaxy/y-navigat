import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AiProvider = "anthropic" | "openai";

export interface AiModelsConfig {
  main: string;
  screening?: string;
}

export interface AiPricingEntry {
  input_per_1m: number;
  output_per_1m: number;
}

export type AiPricing = Record<AiProvider, Record<string, AiPricingEntry>>;

export const DEFAULT_PRICING: AiPricing = {
  anthropic: {
    "claude-sonnet-4-5": { input_per_1m: 3.0, output_per_1m: 15.0 },
    "claude-3-5-haiku-20241022": { input_per_1m: 0.8, output_per_1m: 4.0 },
  },
  openai: {
    "gpt-4o": { input_per_1m: 2.5, output_per_1m: 10.0 },
    "gpt-4o-mini": { input_per_1m: 0.15, output_per_1m: 0.6 },
  },
};

export const MODEL_OPTIONS: Record<AiProvider, string[]> = {
  anthropic: ["claude-sonnet-4-5", "claude-3-5-haiku-20241022"],
  openai: ["gpt-4o", "gpt-4o-mini"],
};

export interface AiSettings {
  provider: AiProvider;
  models: AiModelsConfig;
  pricing: AiPricing;
}

const DEFAULTS: AiSettings = {
  provider: "anthropic",
  models: { main: "claude-sonnet-4-5", screening: "claude-3-5-haiku-20241022" },
  pricing: DEFAULT_PRICING,
};

export function useOrdreAiSettings() {
  const [settings, setSettings] = useState<AiSettings>(DEFAULTS);
  const [secrets, setSecrets] = useState<{ anthropic: boolean; openai: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data, error: e } = await supabase
        .from("platform_settings")
        .select("key,value")
        .eq("category", "ordre_ai");
      if (e) throw e;
      const map = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
      setSettings({
        provider: (map.ai_provider?.provider as AiProvider) ?? DEFAULTS.provider,
        models: { ...DEFAULTS.models, ...(map.ai_models ?? {}) },
        pricing: { ...DEFAULTS.pricing, ...(map.ai_pricing ?? {}) },
      });
      const res = await supabase.functions.invoke("check-ai-secrets");
      if (!res.error && res.data) setSecrets(res.data as any);
    } catch (e: any) {
      setError(e.message ?? "Kunne ikke laste AI-innstillinger");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const save = useCallback(async (next: Partial<AiSettings>) => {
    setSaving(true); setError(null);
    try {
      const merged = { ...settings, ...next };
      const rows = [
        { category: "ordre_ai", key: "ai_provider", value: { provider: merged.provider } },
        { category: "ordre_ai", key: "ai_models", value: merged.models },
        { category: "ordre_ai", key: "ai_pricing", value: merged.pricing },
      ];
      for (const row of rows) {
        const { error: e } = await supabase
          .from("platform_settings")
          .upsert(row, { onConflict: "category,key" });
        if (e) throw e;
      }
      setSettings(merged);
    } catch (e: any) {
      setError(e.message ?? "Kunne ikke lagre");
      throw e;
    } finally {
      setSaving(false);
    }
  }, [settings]);

  return { settings, secrets, loading, saving, error, save, reload };
}
