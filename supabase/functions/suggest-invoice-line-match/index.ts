// AI-forslag til vare og pakning for ÉN fakturalinje.
//
// Funksjonen foreslår og forklarer — den endrer ingenting. Den kan ikke koble,
// bekrefte, godkjenne eller lagre startpris; alt det skjer gjennom
// rm_confirm_line_match etter at et menneske har bekreftet.
//
// Kandidatene hentes på serveren, begrenset til selskapet brukeren har tilgang
// til. Modellen får bare velge blant disse id-ene; alt annet forkastes.

import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptWithKey } from "../_shared/crypto.ts";
import { callAi, extractJson, estimateCostUsd, type AiProvider } from "../_shared/ai-providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Du hjelper en norsk bakeri-regnskapsfører med å tolke én fakturalinje.
Du får linjen og en liste med KANDIDATVARER med id. Du skal:
- velge den kandidaten som mest sannsynlig er riktig vare, eller null hvis ingen passer
- foreslå pakningsstørrelse og pakningsenhet hvis det går klart fram av teksten
- forklare kort på norsk bokmål hvorfor, og nevne hva som er usikkert

Du bekrefter ALDRI noe. Du foreslår.
Du skal kun bruke id-er fra kandidatlisten. Ikke finn på id-er.

Returner kun gyldig JSON på formen:
{"raw_material_id": "<id eller null>", "confidence": 0.0-1.0,
 "package_size": <tall eller null>, "package_unit": "<kg|g|l|dl|ml|stk|pk eller null>",
 "explanation": "<kort norsk forklaring>", "uncertainties": ["<kort punkt>", ...]}`;

const ALLOWED_PACKAGE_UNITS = new Set(["kg", "g", "l", "dl", "ml", "stk", "pk", "pose", "sekk", "kartong", "spann"]);

function jsonErr(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
    const { invoice_line_id, candidate_ids } = body as {
      invoice_line_id?: string;
      candidate_ids?: string[];
    };
    if (!invoice_line_id || typeof invoice_line_id !== "string") {
      return jsonErr("invoice_line_id påkrevd", 400);
    }

    // Linjen leses med brukerens egne rettigheter — RLS avgjør hva som er synlig.
    const { data: line, error: lineErr } = await userClient
      .from("invoice_lines")
      .select(
        "id, description, supplier_sku, quantity, unit, unit_price, total_amount, package_size, package_unit, invoice_id",
      )
      .eq("id", invoice_line_id)
      .maybeSingle();
    if (lineErr) return jsonErr(`Kunne ikke lese fakturalinjen: ${lineErr.message}`, 400);
    if (!line) return jsonErr("Fakturalinjen finnes ikke", 404);

    const { data: invoice, error: invErr } = await userClient
      .from("invoices")
      .select("id, invoice_number, invoice_date, legal_entity_id, supplier_id, currency")
      .eq("id", line.invoice_id)
      .maybeSingle();
    if (invErr) return jsonErr(`Kunne ikke lese fakturaen: ${invErr.message}`, 400);
    if (!invoice?.legal_entity_id) return jsonErr("Fakturaen finnes ikke", 404);

    const legalEntityId = invoice.legal_entity_id as string;
    const { data: hasAccess } = await userClient.rpc("has_ravarer_invoice_access", {
      _legal_entity_id: legalEntityId,
      _required_level: "write",
    });
    if (!hasAccess) return jsonErr("Mangler skrivetilgang til fakturaer", 403);

    // Kandidater: alltid begrenset til selskapet. Klientens liste er et filter,
    // aldri en utvidelse.
    let candQuery = admin
      .from("raw_materials")
      .select("id, name, sku, base_unit, category, item_type")
      .eq("legal_entity_id", legalEntityId)
      .limit(40);
    if (Array.isArray(candidate_ids) && candidate_ids.length > 0) {
      candQuery = candQuery.in("id", candidate_ids.slice(0, 40).map(String));
    } else {
      const words = String(line.description ?? "")
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 4)
        .slice(0, 3);
      if (words.length === 0) return jsonErr("For lite tekst på linjen til å foreslå kandidater", 400);
      candQuery = candQuery.or(words.map((w) => `name.ilike.%${w}%`).join(","));
    }
    const { data: candidates, error: candErr } = await candQuery;
    if (candErr) return jsonErr(`Kunne ikke hente kandidater: ${candErr.message}`, 400);
    if (!candidates || candidates.length === 0) {
      return new Response(
        JSON.stringify({ suggestion: null, reason: "ingen_kandidater" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const allowedIds = new Set(candidates.map((c) => String(c.id)));

    // AI-konfig: samme oppsett som resten av fakturaflyten.
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
    if (!cfg) {
      // Ingen nøkkel er ikke en feil — da jobber man manuelt som før.
      return new Response(JSON.stringify({ suggestion: null, reason: "ingen_ai_konfigurasjon" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = await decryptWithKey(cfg.encrypted_api_key, "AI_CONFIG_ENCRYPTION_KEY");
    const userText = `Fakturalinje:\n${JSON.stringify({
      description: line.description,
      supplier_sku: line.supplier_sku,
      quantity: line.quantity,
      unit: line.unit,
      unit_price: line.unit_price,
      total_amount: line.total_amount,
      currency: invoice.currency,
    })}\n\nKandidatvarer:\n${JSON.stringify(
      candidates.map((c) => ({ id: c.id, name: c.name, sku: c.sku, base_unit: c.base_unit, category: c.category })),
    )}`;

    let parsed: Record<string, unknown> | null = null;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let success = true;
    let errorMessage: string | null = null;

    try {
      const result = await callAi({
        provider: cfg.provider as AiProvider,
        apiKey,
        model: cfg.model,
        maxTokens: Math.max(cfg.max_tokens ?? 1200, 800),
        temperature: Number(cfg.temperature ?? 0.1),
        systemPrompt: SYSTEM_PROMPT,
        userText,
        azureEndpoint: cfg.azure_endpoint ?? undefined,
        azureDeployment: cfg.azure_deployment ?? undefined,
      });
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
      parsed = extractJson(result.rawText) as Record<string, unknown> | null;
    } catch (e) {
      success = false;
      errorMessage = (e as Error).message;
    }

    await admin.from("ai_usage_log").insert({
      provider: cfg.provider,
      model: cfg.model,
      purpose: "invoice_line_match_suggestion",
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: estimateCostUsd(cfg.model, inputTokens, outputTokens),
      legal_entity_id: legalEntityId,
      success,
      error_message: errorMessage,
    });

    if (!success) {
      // AI-feil skal aldri stoppe arbeidet — brukeren fortsetter manuelt.
      return new Response(JSON.stringify({ suggestion: null, reason: "ai_feilet" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rmId = typeof parsed?.raw_material_id === "string" ? parsed.raw_material_id : null;
    const confidence = num(parsed?.confidence);
    const pkgUnitRaw = typeof parsed?.package_unit === "string" ? parsed.package_unit.toLowerCase().trim() : null;
    const pkgSize = num(parsed?.package_size);
    const explanation = typeof parsed?.explanation === "string" ? parsed.explanation.slice(0, 600) : null;
    const uncertainties = Array.isArray(parsed?.uncertainties)
      ? (parsed.uncertainties as unknown[]).filter((u): u is string => typeof u === "string").slice(0, 5)
      : [];

    const suggestion = {
      // Aldri en id modellen fant på.
      raw_material_id: rmId && allowedIds.has(rmId) ? rmId : null,
      confidence: confidence != null && confidence >= 0 && confidence <= 1 ? confidence : null,
      package_size: pkgSize != null && pkgSize > 0 ? pkgSize : null,
      package_unit: pkgUnitRaw && ALLOWED_PACKAGE_UNITS.has(pkgUnitRaw) ? pkgUnitRaw : null,
      explanation,
      uncertainties,
      model: String(cfg.model ?? ""),
    };

    return new Response(JSON.stringify({ suggestion, reason: null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-invoice-line-match error", e);
    return jsonErr((e as Error).message ?? "Ukjent feil", 500);
  }
});
