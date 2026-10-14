// Test an AI provider config without saving it. Sends a tiny prompt and verifies a 200 response.
// If api_key is omitted, falls back to the currently saved config for the given purpose.

import { createClient } from "npm:@supabase/supabase-js@2";
import { callAi, type AiProvider } from "../_shared/ai-providers.ts";
import { decryptWithKey } from "../_shared/crypto.ts";

/** Modeller som kan testes med lagret nøkkel, per lagret provider. Tilkoblingstest — ikke kvalitetsbevis. */
const TESTABLE_MODELS: Record<string, readonly string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-6.1-sol", "gpt-6-luna"],
};
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonErr(msg: string, status: number) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization");
    if (!auth) return jsonErr("Missing Authorization", 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return jsonErr("Not authenticated", 401);
    const { data: isAdmin } = await userClient.rpc("is_platform_admin");
    if (!isAdmin) return jsonErr("Forbidden", 403);

    const body = await req.json().catch(() => ({}));
    let { provider, api_key, model, azure_endpoint, azure_deployment } = body;
    const purpose = body.purpose ?? "invoice_extraction";

    // Lagret nøkkel: provider/endpoint/deployment avledes ALLTID fra lagret konfig.
    // Klienten kan bare velge modell innen samme provider, fra serverens allowlist.
    if (!api_key) {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(supabaseUrl, serviceKey);
      const { data: cfg, error: cfgErr } = await admin
        .from("ai_provider_config")
        .select("id, provider, model, encrypted_api_key, azure_endpoint, azure_deployment")
        .eq("purpose", purpose)
        .eq("is_active", true)
        .maybeSingle();
      if (cfgErr) { console.error("ai-config-test cfg", cfgErr.code); return jsonErr("Kunne ikke hente lagret konfig", 500); }
      if (!cfg) return jsonErr("Ingen lagret AI-konfig — lim inn API-key for å teste", 400);
      if (body.config_id && body.config_id !== cfg.id) return jsonErr("Konfigurasjonen er endret — last siden på nytt", 409);
      if (provider && provider !== cfg.provider) return jsonErr("Lagret nøkkel kan bare testes mot sin egen leverandør", 400);
      if (azure_endpoint || azure_deployment) return jsonErr("Endepunkt kan ikke overstyres for lagret nøkkel", 400);
      const chosen = model ?? cfg.model;
      if (chosen !== cfg.model && !TESTABLE_MODELS[cfg.provider as string]?.includes(chosen)) return jsonErr("Modellen er ikke tillatt", 400);
      try {
        api_key = await decryptWithKey(cfg.encrypted_api_key, "AI_CONFIG_ENCRYPTION_KEY");
      } catch {
        return jsonErr("Dekryptering feilet", 500);
      }
      provider = cfg.provider;
      model = chosen;
      azure_endpoint = cfg.azure_endpoint;
      azure_deployment = cfg.azure_deployment;
    }

    if (!provider || !model) return jsonErr("provider og model påkrevd", 400);
    const reasoning = /^gpt-6/.test(String(model));

    const result = await callAi({
      provider: provider as AiProvider,
      apiKey: api_key,
      model,
      // Reasoningmodeller trenger rom til resonnering; 50 tokens gir tomt svar.
      maxTokens: reasoning ? 1024 : 50,
      temperature: 0,
      systemPrompt: "Svar kun med JSON: {\"ok\": true}",
      userText: "Returner JSON.",
      azureEndpoint: azure_endpoint,
      azureDeployment: azure_deployment,
    });

    return new Response(JSON.stringify({
      ok: true,
      sample_response: result.rawText.slice(0, 200),
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("ai-config-test error", e);
    return jsonErr((e as Error).message ?? "error", 500);
  }
});
