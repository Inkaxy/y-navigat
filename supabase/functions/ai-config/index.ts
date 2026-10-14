// AI provider config: list active configs (without exposing API key) and save/update.
// Restricted to platform admins.

import { createClient } from "npm:@supabase/supabase-js@2";
import { encryptWithKey } from "../_shared/crypto.ts";
import { AI_MODEL_CATALOG, catalogEntry, validateModelSettings } from "../_shared/aiModelCatalog.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonErr(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization");
    if (!auth) return jsonErr("Missing Authorization", 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return jsonErr("Not authenticated", 401);

    const { data: isAdmin } = await userClient.rpc("is_platform_admin");
    if (!isAdmin) return jsonErr("Forbidden — platform admin only", 403);

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "list") {
      const { data, error } = await admin
        .from("ai_provider_config")
        .select("id, provider, model, max_tokens, temperature, is_active, purpose, azure_endpoint, azure_deployment, created_at, updated_at")
        .order("purpose")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify({ configs: data, catalog: AI_MODEL_CATALOG }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "save") {
      const { provider, model, max_tokens, temperature, purpose, azure_endpoint, azure_deployment } = body;
      const api_key = (body.api_key ?? "").trim();
      if (!provider || !api_key || !model || !purpose) {
        return jsonErr("provider, api_key, model og purpose er påkrevd", 400);
      }
      if (!["anthropic", "openai", "azure_openai"].includes(provider)) {
        return jsonErr("Ugyldig provider", 400);
      }
      if (provider === "anthropic" && !api_key.startsWith("sk-ant-")) {
        return jsonErr("Anthropic-nøkkel skal starte med 'sk-ant-'. Sjekk at du limte inn riktig key fra console.anthropic.com.", 400);
      }
      const encrypted = await encryptWithKey(api_key, "AI_CONFIG_ENCRYPTION_KEY");

      // Deactivate existing for this purpose
      await admin.from("ai_provider_config")
        .update({ is_active: false })
        .eq("purpose", purpose)
        .eq("is_active", true);

      const { data, error } = await admin.from("ai_provider_config").insert({
        provider,
        encrypted_api_key: encrypted,
        model,
        max_tokens: max_tokens ?? 2000,
        temperature: temperature ?? 0.1,
        purpose,
        is_active: true,
        azure_endpoint: provider === "azure_openai" ? (azure_endpoint ?? null) : null,
        azure_deployment: provider === "azure_openai" ? (azure_deployment ?? null) : null,
      }).select("id").single();
      if (error) throw error;
      return new Response(JSON.stringify({ id: data.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update_settings") {
      // Bare modell/grenser på eksisterende aktiv konfig. Ingen nøkkel, provider eller endepunkt kan endres her.
      const { id, purpose, provider, expected_updated_at, model, max_tokens, temperature } = body ?? {};
      if (typeof id !== "string" || typeof purpose !== "string" || typeof provider !== "string" || typeof expected_updated_at !== "string" || !expected_updated_at) {
        return jsonErr("id, purpose, provider og expected_updated_at er påkrevd", 400);
      }
      if ("api_key" in body || "azure_endpoint" in body || "azure_deployment" in body) return jsonErr("Nøkkel og endepunkt endres ikke her", 400);
      const invalid = validateModelSettings(provider, model, max_tokens, temperature);
      if (invalid) return jsonErr(invalid, 400);
      const reasoning = catalogEntry(provider, String(model))?.reasoning === true;
      // Én betinget UPDATE: id+purpose+provider+aktiv+eksakt revisjon (mikrosekundstreng sammenlignes av Postgres).
      const { data, error } = await admin.from("ai_provider_config")
        .update({ model, max_tokens, temperature })
        .eq("id", id).eq("purpose", purpose).eq("provider", provider).eq("is_active", true).eq("updated_at", expected_updated_at)
        .select("id, provider, model, max_tokens, temperature, is_active, purpose, azure_endpoint, azure_deployment, created_at, updated_at");
      if (error) { console.error("ai-config update_settings", error.code); return jsonErr("Kunne ikke lagre innstillingene", 500); }
      if (!Array.isArray(data) || data.length !== 1) return jsonErr("Konfigurasjonen er endret av noen andre — last inn på nytt", 409);
      return new Response(JSON.stringify({ config: data[0], temperature_ignored: reasoning }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      const { id } = body;
      if (!id) return jsonErr("id påkrevd", 400);
      const { error } = await admin.from("ai_provider_config").delete().eq("id", id);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "usage_summary") {
      // Last 30 days summary
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await admin
        .from("ai_usage_log")
        .select("provider, model, purpose, input_tokens, output_tokens, estimated_cost_usd, success, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify({ entries: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return jsonErr("Unknown action", 400);
  } catch (e) {
    console.error("ai-config error", e);
    return jsonErr((e as Error).message ?? "error", 500);
  }
});
