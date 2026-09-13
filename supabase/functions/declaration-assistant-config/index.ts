// Oppsett for deklarasjonsassistenten. Kun plattformadministrator.
// API-nøkkelen lagres kryptert i ai_provider_config (purpose = declaration_assistant)
// og returneres ALDRI — verken i klartekst eller kryptert.
//
// All lagring går gjennom ÉN databasefunksjon som tar lås per bruksområde og
// skriver nøkkel, modell, dagsgrense og stilnotater samlet. Feiler noe, står
// hele det forrige oppsettet urørt.

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
    if (!auth) return jsonErr("Mangler pålogging", 401, "unauthenticated");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return jsonErr("Ikke pålogget", 401, "unauthenticated");
    const { data: isAdmin, error: adminErr } = await userClient.rpc("is_platform_admin");
    if (adminErr) return jsonErr("Kunne ikke kontrollere tilgangen", 500, "access_check_failed");
    if (!isAdmin) return jsonErr("Bare plattformadministrator har tilgang", 403, "forbidden");

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "get");
    const encryptionReady = !!Deno.env.get("AI_CONFIG_ENCRYPTION_KEY");

    if (action === "get") {
      const [settingsRes, configRes, quotaRes] = await Promise.all([
        admin
          .from("platform_settings")
          .select("value")
          .eq("category", SETTINGS_CATEGORY)
          .eq("key", SETTINGS_KEY)
          .maybeSingle(),
        admin
          .from("ai_provider_config")
          .select("id, provider, model, is_active, updated_at, created_at")
          .eq("purpose", PURPOSE)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin.rpc("ai_declaration_quota_status"),
      ]);

      // En databasefeil skal ALDRI vises som «ikke satt opp».
      if (settingsRes.error || configRes.error || quotaRes.error) {
        console.error("declaration-assistant-config: kunne ikke lese oppsettet");
        return jsonErr("Kunne ikke lese oppsettet fra databasen.", 500, "read_failed");
      }

      const v = (settingsRes.data?.value ?? {}) as Record<string, unknown>;
      const config = configRes.data;
      const quota = (quotaRes.data ?? {}) as Record<string, unknown>;
      const rawCap = Number(v.daily_cap);
      const model = typeof v.model === "string" ? v.model : DECLARATION_MODEL_ALLOWLIST[0];

      return json({
        // «key_stored» sier bare at en nøkkel ligger lagret — ikke at den virker.
        key_stored: !!config,
        encryption_ready: encryptionReady,
        usable: !!config && encryptionReady,
        provider: "openai",
        model: config?.model ?? model,
        model_valid: (DECLARATION_MODEL_ALLOWLIST as readonly string[]).includes(
          config?.model ?? model,
        ),
        daily_cap: Number.isFinite(rawCap) ? Math.min(Math.max(Math.trunc(rawCap), 1), 500) : 25,
        style_notes: typeof v.style_notes === "string" ? v.style_notes : "",
        used_today: Number(quota.used ?? 0),
        quota_date: String(quota.quota_date ?? ""),
        key_updated_at: config?.updated_at ?? null,
        last_test_at: typeof v.last_test_at === "string" ? v.last_test_at : null,
        last_test_ok: v.last_test_ok === true,
        last_test_code: typeof v.last_test_code === "string" ? v.last_test_code : null,
        config_revision: Number.isFinite(Number(v.config_revision)) ? Number(v.config_revision) : 0,
        last_test_revision: Number.isFinite(Number(v.last_test_revision))
          ? Number(v.last_test_revision)
          : null,
        instruction_version: DECLARATION_INSTRUCTION_VERSION,
        model_options: DECLARATION_MODEL_ALLOWLIST,
      });
    }

    if (action === "save") {
      const model = String(body?.model ?? "");
      if (!(DECLARATION_MODEL_ALLOWLIST as readonly string[]).includes(model)) {
        return jsonErr("Modellen er ikke på den godkjente lista", 400, "bad_model");
      }
      const dailyCap = Number(body?.daily_cap);
      if (!Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > 500) {
        return jsonErr("Daglig grense må være et helt tall mellom 1 og 500", 400, "bad_cap");
      }
      const styleNotes = String(body?.style_notes ?? "").slice(0, 2000);
      const apiKey = String(body?.api_key ?? "").trim();

      let encrypted: string | null = null;
      if (apiKey) {
        if (!encryptionReady) {
          return jsonErr(
            "AI_CONFIG_ENCRYPTION_KEY mangler. Nøkkelen kan ikke lagres trygt før den er satt.",
            409,
            "encryption_missing",
          );
        }
        if (!apiKey.startsWith("sk-") || apiKey.length < 20) {
          return jsonErr("OpenAI-nøkkelen skal starte med «sk-».", 400, "bad_key");
        }
        encrypted = await encryptWithKey(apiKey, "AI_CONFIG_ENCRYPTION_KEY");
      }

      const { error } = await admin.rpc("ai_declaration_config_save", {
        p_model: model,
        p_daily_cap: dailyCap,
        p_style_notes: styleNotes,
        p_updated_by: userRes.user.id,
        p_encrypted_api_key: encrypted,
      });
      if (error) {
        console.error("declaration-assistant-config: lagring feilet");
        return jsonErr("Kunne ikke lagre. Hele det forrige oppsettet er beholdt.", 500, "save_failed");
      }
      return json({ ok: true });
    }

    if (action === "disconnect") {
      // Deaktivering og nullstilling av teststatus skjer atomisk i databasen.
      const { error } = await admin.rpc("ai_declaration_config_disconnect");
      if (error) {
        console.error("declaration-assistant-config: frakobling feilet");
        return jsonErr("Kunne ikke koble fra. Ingenting er endret.", 500, "disconnect_failed");
      }
      return json({ ok: true });
    }

    return jsonErr("Ukjent handling", 400, "bad_request");
  } catch {
    console.error("declaration-assistant-config feilet");
    return jsonErr("Uventet feil i oppsettet", 500, "exception");
  }
});
