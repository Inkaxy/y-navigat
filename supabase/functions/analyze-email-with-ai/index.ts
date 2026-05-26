// Analyserer en ticket-epost med valgt AI-provider, returnerer strukturert ordre-forslag (v2).
// Lagrer på tickets.ai_suggestion + ai_call_log.

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { callAi, estimateCostUsd } from "../_shared/ai-providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const NB_LEGAL_ENTITY_ID = "751709bc-04b3-4449-867d-b97faa9ab373";

function jsonErr(msg: string, status: number, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error: msg, ...extra }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const InputSchema = z.object({
  ticket_id: z.string().uuid(),
  force: z.boolean().optional(),
});

const REQUEST_TYPES = [
  "new_order",
  "change",
  "cancellation",
  "question",
  "complaint",
  "internal",
  "unclear",
  "spam",
] as const;

const SuggestionSchema = z.object({
  request_type: z.enum(REQUEST_TYPES),
  summary: z.string(),
  suggested_action: z.string(),
  customer_match: z.object({
    customer_id: z.string().uuid().nullable(),
    customer_name: z.string().nullable(),
    match_confidence: z.number().min(0).max(1),
  }).nullable(),
  order_fields: z.object({
    delivery_date: z.string().nullable().optional(),
    delivery_time: z.string().nullable().optional(),
    pickup_location_hint: z.string().nullable().optional(),
    delivery_address_line1: z.string().nullable().optional(),
    delivery_address_line2: z.string().nullable().optional(),
    delivery_postal_code: z.string().nullable().optional(),
    delivery_city: z.string().nullable().optional(),
    customer_notes: z.string().nullable().optional(),
    internal_notes: z.string().nullable().optional(),
    production_notes: z.string().nullable().optional(),
    cake_text: z.string().nullable().optional(),
    allergies: z.string().nullable().optional(),
    special_requests: z.string().nullable().optional(),
    contact_phone: z.string().nullable().optional(),
    contact_email: z.string().nullable().optional(),
  }).default({}),
  products: z.array(z.object({
    product_id: z.string().uuid().nullable(),
    product_name: z.string(),
    quantity: z.number(),
    size_or_servings: z.string().nullable().optional(),
    flavor: z.string().nullable().optional(),
    filling: z.string().nullable().optional(),
    decoration: z.string().nullable().optional(),
    match_confidence: z.number().min(0).max(1),
  })),
  missing_info: z.array(z.object({
    code: z.string(),
    label: z.string(),
  })).default([]),
  risks: z.array(z.object({
    severity: z.enum(["red", "yellow", "green"]),
    code: z.string(),
    message: z.string(),
  })).default([]),
  field_confidence: z.record(z.number().min(0).max(1)).default({}),
  reasoning_per_field: z.record(z.string()).default({}),
  // tour beholdes for bakoverkomp
  tour: z.object({
    tour_id: z.string().uuid().nullable(),
    tour_name: z.string().nullable(),
  }).nullable().optional(),
  delivery_date: z.string().nullable().optional(), // bakoverkomp
  confidence_score: z.number().min(0).max(1),
  reasoning: z.string(),
});

function trimEmailBody(text: string | null | undefined): string {
  if (!text) return "";
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .split(/\n--+\s*Original Message\s*--+|\n_{5,}|\nFra:\s/i)[0]
    .trim();
  return cleaned.slice(0, 4000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return jsonErr("Missing Authorization", 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return jsonErr("Not authenticated", 401);
    const userId = userRes.user.id;

    const { data: hasAccess } = await userClient.rpc("has_ordre_settings_access");
    if (!hasAccess) {
      const { data: hasWrite } = await userClient.rpc("has_app_write_access", { p_app_code: "ordre" });
      if (!hasWrite) return jsonErr("Forbidden", 403);
    }

    const parsed = InputSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return jsonErr("Ugyldig input", 400, { details: parsed.error.flatten() });
    const { ticket_id, force } = parsed.data;

    const { data: ticket, error: tErr } = await admin
      .from("tickets").select("*").eq("id", ticket_id).maybeSingle();
    if (tErr) throw tErr;
    if (!ticket) return jsonErr("Ticket ikke funnet", 404);

    if (ticket.ai_analyzed_at && !force) {
      return new Response(JSON.stringify({
        ok: true, cached: true, analysis: ticket.ai_suggestion,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: settingsRows } = await admin
      .from("platform_settings")
      .select("key,value")
      .eq("category", "ordre_ai");
    const settings = Object.fromEntries((settingsRows ?? []).map((r: any) => [r.key, r.value]));
    const provider = (settings.ai_provider?.provider ?? "anthropic") as "anthropic" | "openai";
    const models = settings.ai_models ?? {};
    const model = (models.main ?? (provider === "anthropic" ? "claude-sonnet-4-5" : "gpt-4o")) as string;
    const pricing = settings.ai_pricing ?? {};

    const apiKey = (Deno.env.get(provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY") ?? "").trim();
    if (!apiKey) {
      return jsonErr(`Provider ${provider} er ikke konfigurert (mangler API-nøkkel-secret)`, 503);
    }

    const [{ data: customers }, { data: products }, { data: pickups }] = await Promise.all([
      admin.from("customers")
        .select("id,display_name,customer_number,primary_contact_email")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("status", "active")
        .limit(200),
      admin.from("products")
        .select("id,display_name,display_number,unit_of_sale")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("status", "active")
        .eq("is_for_sale", true)
        .limit(200),
      admin.from("pickup_locations")
        .select("id,display_name,city")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("status", "active")
        .limit(50),
    ]);

    const bodyText = trimEmailBody(ticket.body_text ?? ticket.body_preview ?? "");
    const todayISO = new Date().toISOString().slice(0, 10);

    const systemPrompt = `Du er en assistent som leser e-post sendt til Nøtterø Bakeri sitt ordrekontor og lager en strukturert analyse for en saksbehandler.

Dagens dato: ${todayISO}.

Returner KUN gyldig JSON som matcher dette schemaet (ingen markdown, ingen tekst rundt):
{
  "request_type": "new_order"|"change"|"cancellation"|"question"|"complaint"|"internal"|"unclear"|"spam",
  "summary": string (1-3 setninger på norsk),
  "suggested_action": string (kort handlingsforslag på norsk),
  "customer_match": { "customer_id": uuid|null, "customer_name": string|null, "match_confidence": 0..1 } | null,
  "order_fields": {
    "delivery_date": "YYYY-MM-DD"|null,
    "delivery_time": "HH:MM"|null,
    "pickup_location_hint": string|null,
    "delivery_address_line1": string|null,
    "delivery_address_line2": string|null,
    "delivery_postal_code": string|null,
    "delivery_city": string|null,
    "customer_notes": string|null,
    "internal_notes": string|null,
    "production_notes": string|null,
    "cake_text": string|null,
    "allergies": string|null,
    "special_requests": string|null,
    "contact_phone": string|null,
    "contact_email": string|null
  },
  "products": [{
    "product_id": uuid|null,
    "product_name": string,
    "quantity": number,
    "size_or_servings": string|null,
    "flavor": string|null,
    "filling": string|null,
    "decoration": string|null,
    "match_confidence": 0..1
  }],
  "missing_info": [{ "code": string, "label": string }],
  "risks": [{ "severity": "red"|"yellow"|"green", "code": string, "message": string }],
  "field_confidence": { "delivery_date": 0..1, "customer_id": 0..1, "pickup": 0..1, ... },
  "reasoning_per_field": { "delivery_date": "kunden skrev 'lørdag'", ... },
  "confidence_score": 0..1,
  "reasoning": string (kort overordnet begrunnelse på norsk)
}

Regler:
- request_type: klassifiser ut fra om kunden bestiller noe nytt, ber om endring, vil avbestille, stiller spørsmål, klager, eller om eposten er intern/uklar/spam.
- customer_match: prøv først match på sender-epost mot primary_contact_email, deretter navn i e-posten. Sett customer_id=null hvis usikker.
- products: match på navn. Ikke gjett UUID — sett product_id=null hvis usikker.
- missing_info: list opp felt som mangler for at en ordre skal kunne opprettes (telefonnummer, hentetid, hentested, fyll, kaketekst, antall, …). Bruk korte koder ('phone','pickup_time','pickup','filling','cake_text','quantity','customer','product') og norske labels.
- risks: flagg ting saksbehandleren må sjekke. severity 'red' = må løses før ordre, 'yellow' = bør kontrolleres, 'green' = OK. Eksempler: relativ dato ('neste fredag'), uklar hentested, mulig duplikat, allergi nevnt, for kort frist, ukjent produkt.
- delivery_date må være ISO YYYY-MM-DD (regn ut fra dagens dato hvis kunden skrev relativt).
- pickup_location_hint = fritekst kunden brukte (f.eks. "Majorstua"). IKKE gjett UUID.
- order_fields.cake_text/allergies/special_requests skal fylles ut hvis nevnt — ikke pakk inn i prosa.
- Hold sammendrag og reasoning korte og praktiske.`;

    const userText = [
      `=== TICKET ===`,
      `Emne: ${ticket.subject ?? ""}`,
      `Avsender: ${ticket.sender_name ?? ""} <${ticket.sender_email ?? ""}>`,
      `Mottatt: ${ticket.received_at ?? ""}`,
      ``,
      `--- E-post-tekst ---`,
      bodyText,
      ``,
      `=== KUNDER (id | kundenr | navn | epost) ===`,
      (customers ?? []).map((c: any) => `${c.id} | ${c.customer_number ?? ""} | ${c.display_name} | ${c.primary_contact_email ?? ""}`).join("\n"),
      ``,
      `=== PRODUKTER (id | nr | navn | enhet) ===`,
      (products ?? []).map((p: any) => `${p.id} | ${p.display_number ?? ""} | ${p.display_name} | ${p.unit_of_sale ?? ""}`).join("\n"),
      ``,
      `=== HENTESTEDER (navn | by) ===`,
      (pickups ?? []).map((p: any) => `${p.display_name} | ${p.city ?? ""}`).join("\n"),
    ].join("\n");

    const startTs = Date.now();
    let rawText = "";
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let callError: string | null = null;
    let callStatus: "success" | "error" | "rate_limited" = "success";

    try {
      const result = await callAi({
        provider,
        apiKey,
        model,
        maxTokens: 3072,
        temperature: 0.1,
        systemPrompt,
        userText,
      });
      rawText = result.rawText;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    } catch (e) {
      callError = (e as Error).message;
      if (/credit balance|insufficient.?credit|quota|billing/i.test(callError)) {
        callError = `${provider} har ikke nok kreditt på kontoen. Fyll på kreditt hos provider, eller bytt provider i Innstillinger → AI.`;
        callStatus = "error";
      } else if (/rate.?limit|429/i.test(callError)) {
        callStatus = "rate_limited";
      } else {
        callStatus = "error";
      }
    }

    const durationMs = Date.now() - startTs;

    let suggestion: z.infer<typeof SuggestionSchema> | null = null;
    if (callStatus === "success") {
      try {
        const cleaned = rawText.replace(/```(?:json)?\s*/g, "").replace(/```\s*$/, "").trim();
        const json = JSON.parse(cleaned);
        // Bakoverkomp: hvis modellen returnerte gammelt format uten request_type, oppgrader minimalt
        if (json && typeof json === "object" && !json.request_type) {
          json.request_type = "unclear";
          json.summary = json.summary ?? "";
          json.suggested_action = json.suggested_action ?? "";
          json.order_fields = json.order_fields ?? {};
          json.missing_info = json.missing_info ?? [];
          json.risks = json.risks ?? [];
          json.field_confidence = json.field_confidence ?? {};
          json.reasoning_per_field = json.reasoning_per_field ?? {};
        }
        const result = SuggestionSchema.safeParse(json);
        if (!result.success) {
          callStatus = "error";
          callError = "AI returnerte ugyldig JSON-struktur: " + JSON.stringify(result.error.flatten()).slice(0, 400);
        } else {
          suggestion = result.data;
        }
      } catch (e) {
        callStatus = "error";
        callError = "Kunne ikke parse AI-respons som JSON: " + (e as Error).message;
      }
    }

    let costUsd: number | null = null;
    const priceCfg = pricing?.[provider]?.[model];
    if (priceCfg && inputTokens != null && outputTokens != null) {
      costUsd = (inputTokens * (priceCfg.input_per_1m ?? 0) + outputTokens * (priceCfg.output_per_1m ?? 0)) / 1_000_000;
    } else {
      costUsd = estimateCostUsd(model, inputTokens, outputTokens);
    }

    const updateData: Record<string, unknown> = {
      ai_status: callStatus === "success" ? "success" : callStatus,
      ai_provider: provider,
      ai_model: model,
      ai_analyzed_at: new Date().toISOString(),
      ai_cost_usd: costUsd,
      ai_error: callError,
      ai_confidence_score: suggestion?.confidence_score ?? null,
      ai_suggestion: suggestion ?? null,
    };
    await admin.from("tickets").update(updateData).eq("id", ticket_id);

    await admin.from("ai_call_log").insert({
      ticket_id,
      triggered_by: userId,
      provider,
      model,
      status: callStatus,
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      cost_usd: costUsd,
      confidence_score: suggestion?.confidence_score ?? null,
      duration_ms: durationMs,
      error: callError,
      request_payload: {
        ticket_subject: ticket.subject,
        ticket_sender: ticket.sender_email,
        body_length: bodyText.length,
        customers_count: customers?.length ?? 0,
        products_count: products?.length ?? 0,
        pickups_count: pickups?.length ?? 0,
      },
      response_payload: suggestion ? {
        request_type: suggestion.request_type,
        customer_matched: !!suggestion.customer_match?.customer_id,
        products_count: suggestion.products.length,
        missing_count: suggestion.missing_info.length,
        risks_count: suggestion.risks.length,
        confidence: suggestion.confidence_score,
      } : null,
    });

    if (callStatus !== "success") {
      return jsonErr(callError ?? "AI-kall feilet", 502, { status: callStatus });
    }

    return new Response(JSON.stringify({ ok: true, analysis: suggestion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-email-with-ai error", e);
    return jsonErr((e as Error).message ?? "error", 500);
  }
});
