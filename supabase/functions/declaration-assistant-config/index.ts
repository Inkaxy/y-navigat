// Oppsett for deklarasjonsassistenten. Kun plattformadministrator.
// API-nøkkelen lagres kryptert i ai_provider_config (purpose = declaration_assistant)
// og returneres ALDRI — verken i klartekst eller kryptert.

import { createClient } from "npm:@supabase/supabase-js@2";
import { encryptWithKey } from "../_shared/crypto.ts";
import {
  DECLARATION_INSTRUCTION_VERSION,
  DECLARATION_MODEL_ALLOWLIST,
} from "../_shared/declaration-instructions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PURPOSE = "declaration_assistant";
const SETTINGS_CATEGORY = "varer_ai";
const SETTINGS_KEY = "declaration_assistant";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonErr(message: string, status: number, code?: string) {
  return json({ error: message, code }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization");
    if (!auth) return jsonErr("Mangler pålogging", 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return jsonErr("Ikke pålogget", 401);
    const { data: isAdmin } = await userClient.rpc("is_platform_admin");
    if (!isAdmin) return jsonErr("Bare plattformadministrator har tilgang", 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "get");
    const encryptionReady = !!Deno.env.get("AI_CONFIG_ENCRYPTION_KEY");

    async function readSettings() {
      const { data } = await admin
        .from("platform_settings")
        .select("value")
        .eq("category", SETTINGS_CATEGORY)
        .eq("key", SETTINGS_KEY)
        .maybeSingle();
      const v = (data?.value ?? {}) as Record<string, unknown>;
      return {
        model: typeof v.model === "string" ? v.model : DECLARATION_MODEL_ALLOWLIST[0],
        daily_cap: Number.isFinite(Number(v.daily_cap)) ? Number(v.daily_cap) : 25,
        style_notes: typeof v.style_notes === "string" ? v.style_notes : "",
      };
    }

    async function readConfig() {
      const { data } = await admin
        .from("ai_provider_config")
        .select("id, provider, model, max_tokens, is_active, updated_at, created_at")
        .eq("purpose", PURPOSE)
        .eq("is_active", true)
        .maybeSingle();
      return data;
    }

    if (action === "get") {
      const [settings, config] = await Promise.all([readSettings(), readConfig()]);
      const today = new Date().toISOString().slice(0, 10);
      const { data: quota } = await admin
        .from("ai_declaration_quota")
        .select("used_count")
        .eq("quota_date", today)
        .maybeSingle();
      return json({
        configured: !!config && encryptionReady,
        encryption_ready: encryptionReady,
        provider: "openai",
        model: config?.model ?? settings.model,
        daily_cap: settings.daily_cap,
        style_notes: settings.style_notes,
        used_today: quota?.used_count ?? 0,
        key_updated_at: config?.updated_at ?? null,
        instruction_version: DECLARATION_INSTRUCTION_VERSION,
        model_options: DECLARATION_MODEL_ALLOWLIST,
      });
    }

    if (action === "save") {
      const model = String(body?.model ?? "");
      if (!(DECLARATION_MODEL_ALLOWLIST as readonly string[]).includes(model)) {
        return jsonErr("Modellen er ikke på den godkjente lista", 400);
      }
      const dailyCap = Number(body?.daily_cap);
      if (!Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > 500) {
        return jsonErr("Daglig grense må være et helt tall mellom 1 og 500", 400);
      }
      const styleNotes = String(body?.style_notes ?? "").slice(0, 2000);
      const apiKey = String(body?.api_key ?? "").trim();

      if (apiKey) {
        if (!encryptionReady) {
          return jsonErr(
            "AI_CONFIG_ENCRYPTION_KEY mangler. Nøkkelen kan ikke lagres trygt før den er satt.",
            409,
            "encryption_missing",
          );
        }
        if (!apiKey.startsWith("sk-")) {
          return jsonErr("OpenAI-nøkkelen skal starte med «sk-».", 400);
        }
        const encrypted = await encryptWithKey(apiKey, "AI_CONFIG_ENCRYPTION_KEY");
        const { error } = await admin.rpc("ai_config_replace_active", {
          p_purpose: PURPOSE,
          p_provider: "openai",
          p_encrypted_api_key: encrypted,
          p_model: model,
          p_max_tokens: 1500,
          p_temperature: 0,
        });
        // Feiler byttet, står det gamle oppsettet urørt.
        if (error) return jsonErr("Kunne ikke lagre nøkkelen. Forrige oppsett er beholdt.", 500);
      } else {
        const existing = await readConfig();
        if (existing && existing.model !== model) {
          await admin.from("ai_provider_config").update({ model, updated_at: new Date().toISOString() })
            .eq("id", existing.id);
        }
      }

      const { error: sErr } = await admin.from("platform_settings").upsert(
        {
          category: SETTINGS_CATEGORY,
          key: SETTINGS_KEY,
          value: { model, daily_cap: dailyCap, style_notes: styleNotes },
          updated_by: userRes.user.id,
        },
        { onConflict: "category,key" },
      );
      if (sErr) return jsonErr("Kunne ikke lagre innstillingene", 500);
      return json({ ok: true });
    }

    if (action === "disconnect") {
      const { error } = await admin
        .from("ai_provider_config")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("purpose", PURPOSE)
        .eq("is_active", true);
      if (error) return jsonErr("Kunne ikke koble fra", 500);
      return json({ ok: true });
    }

    return jsonErr("Ukjent handling", 400);
  } catch (e) {
    console.error("declaration-assistant-config feilet", (e as Error).message);
    return jsonErr("Uventet feil i oppsettet", 500);
  }
});
