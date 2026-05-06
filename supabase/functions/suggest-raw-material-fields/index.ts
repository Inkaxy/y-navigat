// Suggest raw material fields (sku, category, base_unit) for invoice lines
// using the configured AI provider.

import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptWithKey } from "../_shared/crypto.ts";
import { callAi, extractJson, estimateCostUsd, type AiProvider } from "../_shared/ai-providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Du analyserer fakturalinjer fra et norsk bakeri og foreslår strukturerte
råvaredata som hjelper med katalogisering. Returner kun gyldig JSON.

For hver linje, foreslå:
- sku (string): kort, lesbar SKU på 8-15 tegn. Format:
  "[KATEGORI-FORKORTELSE]-[NAVN-FORKORTELSE]-[STR]"
  (f.eks. "HVET-SIG-25" for "Hvetemel Sigdal 25kg").
  Bruk store bokstaver, kun A-Z og 0-9 og bindestrek.
- category (string): mest sannsynlige kategori basert på beskrivelsen.
  Velg fra denne listen hvis mulig:
  ["mel", "sukker", "fett", "frø", "frukt_baer", "smaksetting",
   "gjær", "salt", "egg", "meieri", "sjokolade", "noetter",
   "krydder", "konserveringsmiddel", "emballasje", "annet"]
- base_unit (string): "kg", "l" eller "stk". Utled fra mengde-enheten
  på linja og varens natur (mel = kg, melk = l, etc.).
- confidence (number 0-1): hvor sikker du er på forslagene. Lav confidence
  for uvanlige eller flertydige beskrivelser.

Hvis du er svært usikker, returner null på de feltene.
Returner ALLTID et JSON-objekt på formen:
{ "suggestions": [ { "line_id": "...", "sku": "...", "category": "...", "base_unit": "...", "confidence": 0.x }, ... ] }
med ett objekt pr linje.`;

function jsonErr(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return jsonErr("Not authenticated", 401);

    const body = await req.json().catch(() => ({}));
    const { legal_entity_id, lines } = body as {
      legal_entity_id?: string;
      lines?: Array<{ line_id: string; description?: string; sku?: string; quantity?: number; unit?: string; unit_price?: number }>;
    };
    if (!legal_entity_id) return jsonErr("legal_entity_id påkrevd", 400);
    if (!Array.isArray(lines) || lines.length === 0) return jsonErr("lines påkrevd", 400);

    const { data: hasAccess } = await userClient.rpc("has_ravarer_invoice_access", {
      _legal_entity_id: legal_entity_id,
      _required_level: "write",
    });
    if (!hasAccess) return jsonErr("Mangler skrivetilgang til fakturaer", 403);

    // Hent AI-konfig for dette formålet, fall tilbake til invoice_extraction
    let { data: cfg } = await admin
      .from("ai_provider_config")
      .select("*")
      .eq("purpose", "raw_material_suggestions")
      .eq("is_active", true)
      .maybeSingle();
    if (!cfg) {
      const { data: fb } = await admin
        .from("ai_provider_config")
        .select("*")
        .eq("purpose", "invoice_extraction")
        .eq("is_active", true)
        .maybeSingle();
      cfg = fb ?? null;
    }
    if (!cfg) return jsonErr("Ingen AI-konfigurasjon funnet. Konfigurer en AI-tjeneste i Råvarer → Innstillinger.", 400);

    const apiKey = await decryptWithKey(cfg.encrypted_api_key, "AI_CONFIG_ENCRYPTION_KEY");
    const userText = `Fakturalinjer (JSON):\n${JSON.stringify(lines)}`;

    let suggestions: any[] = [];
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let success = true;
    let errorMessage: string | null = null;

    try {
      const result = await callAi({
        provider: cfg.provider as AiProvider,
        apiKey,
        model: cfg.model,
        maxTokens: Math.max(cfg.max_tokens ?? 2000, 2000),
        temperature: Number(cfg.temperature ?? 0.1),
        systemPrompt: SYSTEM_PROMPT,
        userText,
        azureEndpoint: cfg.azure_endpoint ?? undefined,
        azureDeployment: cfg.azure_deployment ?? undefined,
      });
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
      const parsed = extractJson(result.rawText);
      const arr = Array.isArray(parsed?.suggestions) ? parsed.suggestions : Array.isArray(parsed) ? parsed : [];
      suggestions = arr;
    } catch (e) {
      success = false;
      errorMessage = (e as Error).message;
    }

    await admin.from("ai_usage_log").insert({
      provider: cfg.provider,
      model: cfg.model,
      purpose: "raw_material_suggestions",
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: estimateCostUsd(cfg.model, inputTokens, outputTokens),
      legal_entity_id,
      success,
      error_message: errorMessage,
    });

    if (!success) return jsonErr(errorMessage ?? "AI-kall feilet", 500);

    // Normaliser/valider hver suggestion
    const allowedUnits = new Set(["kg", "l", "stk"]);
    const cleaned = suggestions.map((s) => ({
      line_id: String(s?.line_id ?? ""),
      sku: typeof s?.sku === "string" ? s.sku.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20) : null,
      category: typeof s?.category === "string" ? s.category : null,
      base_unit: typeof s?.base_unit === "string" && allowedUnits.has(s.base_unit) ? s.base_unit : null,
      confidence: typeof s?.confidence === "number" ? Math.max(0, Math.min(1, s.confidence)) : null,
    })).filter((s) => s.line_id);

    return new Response(JSON.stringify({ suggestions: cleaned }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-raw-material-fields error", e);
    return jsonErr((e as Error).message ?? "error", 500);
  }
});
