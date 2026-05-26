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
    store_notes: z.string().nullable().optional(),
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
  // Runde 2: kandidat-ordre + endringer
  candidate_orders: z.array(z.object({
    order_id: z.string().uuid(),
    order_number: z.string().nullable(),
    match_confidence: z.number().min(0).max(1),
    why_match: z.string(),
    snapshot: z.object({
      delivery_date: z.string().nullable().optional(),
      delivery_time: z.string().nullable().optional(),
      status: z.string().nullable().optional(),
      customer_name: z.string().nullable().optional(),
      line_summary: z.string().nullable().optional(),
    }).nullable().optional(),
  })).default([]),
  referenced_order: z.object({
    order_id: z.string().uuid(),
    order_number: z.string().nullable(),
    match_confidence: z.number().min(0).max(1),
  }).nullable().optional(),
  change_intent: z.object({
    target_order_id: z.string().uuid().nullable(),
    changes: z.array(z.object({
      field: z.string(),
      current_value: z.string().nullable(),
      proposed_value: z.string().nullable(),
      reasoning: z.string(),
      confidence: z.number().min(0).max(1),
    })).default([]),
    cancellation_reason: z.string().nullable().optional(),
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
        .select("id,display_name,customer_number,primary_contact_email,primary_contact_phone,mobile_phone")
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

    // --- Runde 2: hent kandidat-ordre ---
    // Strategi: (1) match sender_email mot kundens primary_contact_email,
    // (2) regex etter ordrenr i bodyen (f.eks. 2025-1234 eller #1234),
    // (3) hent aktive/fremtidige ordrer for de matchede kundene + eventuelle eksplisitte ordrenr.
    const senderEmail = (ticket.sender_email ?? "").toLowerCase().trim();
    const matchedCustomerIds = new Set<string>();
    for (const c of customers ?? []) {
      const e1 = (c.primary_contact_email ?? "").toLowerCase().trim();
      if (senderEmail && e1 && e1 === senderEmail) matchedCustomerIds.add(c.id);
    }
    const rawBody = (ticket.body_text ?? ticket.body_preview ?? "").slice(0, 8000);
    const orderNumberMatches = Array.from(
      rawBody.matchAll(/(?:ordre\w*\s*(?:nr|nummer)?\s*[:#]?\s*|#)\s*(\d{2,4}[-\s]?\d{3,6})/gi),
    ).map((m) => m[1].replace(/\s/g, "").replace(/^(\d{2,4})(\d{3,6})$/, "$1-$2"));
    const today = new Date(); today.setHours(0,0,0,0);
    const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 60);
    const cutoffISO = cutoff.toISOString().slice(0,10);
    const activeStatuses = ["draft","awaiting_confirmation","confirmed","in_production","packed","on_hold"];
    let candidateOrdersRaw: any[] = [];
    if (matchedCustomerIds.size > 0 || orderNumberMatches.length > 0) {
      let q = admin.from("orders")
        .select("id,order_number,status,delivery_date,delivery_time,customer_id,customer_snapshot,delivery_address_line1,delivery_postal_code,delivery_city,customer_notes,internal_notes")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .gte("delivery_date", cutoffISO)
        .in("status", activeStatuses)
        .order("delivery_date", { ascending: true })
        .limit(20);
      const orFilters: string[] = [];
      if (matchedCustomerIds.size > 0) {
        orFilters.push(`customer_id.in.(${Array.from(matchedCustomerIds).join(",")})`);
      }
      for (const onr of orderNumberMatches) {
        orFilters.push(`order_number.eq.${onr}`);
      }
      if (orFilters.length > 0) q = q.or(orFilters.join(","));
      const { data: cand } = await q;
      candidateOrdersRaw = cand ?? [];
    }
    // Hent linjer for kandidatene for snapshot
    const candIds = candidateOrdersRaw.map((o: any) => o.id);
    let linesByOrder: Record<string, any[]> = {};
    if (candIds.length > 0) {
      const { data: lines } = await admin.from("order_lines")
        .select("order_id,line_number,quantity,product_snapshot,notes")
        .in("order_id", candIds)
        .order("line_number", { ascending: true });
      for (const l of lines ?? []) {
        (linesByOrder[l.order_id] = linesByOrder[l.order_id] || []).push(l);
      }
    }


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
  "order_fields": { ... samme som før ... },
  "products": [{ ... samme som før ... }],
  "missing_info": [{ "code": string, "label": string }],
  "risks": [{ "severity": "red"|"yellow"|"green", "code": string, "message": string }],
  "field_confidence": { ... },
  "reasoning_per_field": { ... },
  "candidate_orders": [{
    "order_id": uuid,            // MÅ være en av order_id-ene i KANDIDAT-ORDRE-lista nedenfor
    "order_number": string|null,
    "match_confidence": 0..1,
    "why_match": string (kort norsk forklaring),
    "snapshot": { "delivery_date": "YYYY-MM-DD"|null, "delivery_time": string|null, "status": string|null, "customer_name": string|null, "line_summary": string|null }
  }],
  "referenced_order": { "order_id": uuid, "order_number": string|null, "match_confidence": 0..1 } | null,
  "change_intent": {
    "target_order_id": uuid|null,
    "changes": [{
      "field": "delivery_date"|"delivery_time"|"customer_notes"|"internal_notes"|"delivery_address_line1"|"delivery_address_line2"|"delivery_postal_code"|"delivery_city",
      "current_value": string|null,
      "proposed_value": string|null,
      "reasoning": string,
      "confidence": 0..1
    }],
    "cancellation_reason": string|null
  } | null,
  "confidence_score": 0..1,
  "reasoning": string
}

Regler:
- request_type: klassifiser ut fra om kunden bestiller noe nytt, ber om endring, vil avbestille, stiller spørsmål, klager, eller om eposten er intern/uklar/spam.
- candidate_orders: velg 0-3 fra KANDIDAT-ORDRE-lista som ser ut til å være relevante for denne eposten. Bruk EKSAKTE order_id fra lista. La være tom hvis ingen passer.
- referenced_order: hvis eposten tydelig handler om EN spesifikk eksisterende ordre (endring/kansellering/spørsmål), sett denne til den mest sannsynlige. Ellers null.
- change_intent: SETT KUN når request_type = "change" eller "cancellation". target_order_id skal være eksisterende order_id fra kandidatlista (eller referenced_order). Kun feltene i whitelisten over kan endres — for andre endringer (kaketekst, antall, fyll osv.) skal du beskrive dem i "summary" og "suggested_action", men IKKE i changes.
- cancellation_reason: kort grunn på norsk hvis kunden vil kansellere.
- current_value: hva som står i ordren nå (slå opp i kandidat-snapshotet). Hvis ukjent, sett null.
- proposed_value: hva kunden ønsker å endre til. Bruk samme format som lagret (YYYY-MM-DD for dato, HH:MM for tid).
- customer_match / products / missing_info / risks: som tidligere.
- Norsk datoformat er DD-MM-YYYY. delivery_date i utdata må være ISO YYYY-MM-DD.
- Hold sammendrag og reasoning korte og praktiske.

PRODUCTION_NOTES (order_fields.production_notes) — tekst til BAKERIET. Skal være kort, strukturert, og inneholde KUN det produksjon trenger. Bruk én linje per punkt med "Felt: verdi"-format. Inkluder alle relevante: Produkt, Antall, Størrelse/personer, Kaketekst, Pynt, Fyll, Smak, Allergier, Spesialønsker, Vedlegg fra kunde (hvis nevnt), "Obs:" for ting produksjon må være ekstra oppmerksom på (kort frist, uvanlig størrelse osv.). Sett null hvis intet relevant.

STORE_NOTES (order_fields.store_notes) — tekst til UTLEVERINGSSTEDET/BUTIKKEN. Kort og strukturert, én linje per punkt. Inkluder: Hentetid, Kundenavn, Telefon, Betalingsstatus (hvis nevnt eller utledet), "Kontakt kunde:" hvis noe må avklares før henting, Hentebeskjeder (samme dag, ringer ved ankomst, parkering osv.), "Endret:" hvis ordren er endret etter bekreftelse. Sett null hvis intet relevant.

Begge notatene skal være på norsk, vennlige men telegrafiske. IKKE gjenta hele e-postteksten.`;

    const userText = [
      `=== TICKET ===`,
      `Emne: ${ticket.subject ?? ""}`,
      `Avsender: ${ticket.sender_name ?? ""} <${ticket.sender_email ?? ""}>`,
      `Mottatt: ${ticket.received_at ?? ""}`,
      ``,
      `--- E-post-tekst ---`,
      bodyText,
      ``,
      `=== KUNDER (id | kundenr | navn | epost | telefon) ===`,
      (customers ?? []).map((c: any) => `${c.id} | ${c.customer_number ?? ""} | ${c.display_name} | ${c.primary_contact_email ?? ""} | ${c.primary_contact_phone ?? c.mobile_phone ?? ""}`).join("\n"),
      ``,
      `=== PRODUKTER (id | nr | navn | enhet) ===`,
      (products ?? []).map((p: any) => `${p.id} | ${p.display_number ?? ""} | ${p.display_name} | ${p.unit_of_sale ?? ""}`).join("\n"),
      ``,
      `=== HENTESTEDER (navn | by) ===`,
      (pickups ?? []).map((p: any) => `${p.display_name} | ${p.city ?? ""}`).join("\n"),
      ``,
      `=== KANDIDAT-ORDRE (order_id | ordrenr | status | hentedato | hentetid | kunde | linjer | kundenotat | adresse) ===`,
      candidateOrdersRaw.length === 0
        ? "(ingen aktive/fremtidige ordre funnet for denne kunden eller refererte ordrenr)"
        : candidateOrdersRaw.map((o: any) => {
            const cn = o.customer_snapshot?.display_name ?? o.customer_snapshot?.name ?? "";
            const ls = (linesByOrder[o.id] ?? []).slice(0, 5).map((l: any) => {
              const name = l.product_snapshot?.display_name ?? l.product_snapshot?.name ?? "?";
              return `${l.quantity}x ${name}`;
            }).join(", ");
            const addr = [o.delivery_address_line1, o.delivery_postal_code, o.delivery_city].filter(Boolean).join(" ");
            return `${o.id} | ${o.order_number ?? ""} | ${o.status} | ${o.delivery_date ?? ""} | ${o.delivery_time ?? ""} | ${cn} | ${ls} | ${o.customer_notes ?? ""} | ${addr}`;
          }).join("\n"),
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

    // Tidslinje-hendelse
    await admin.from("ticket_events").insert({
      ticket_id,
      order_id: ticket.related_order_id ?? null,
      event_type: callStatus === "success" ? "ai.analysis_completed" : "ai.analysis_failed",
      actor_type: "ai",
      actor_user_id: userId ?? null,
      actor_label: `${provider}/${model}`,
      summary: callStatus === "success"
        ? `${suggestion?.request_type ?? "?"} · konfidens ${Math.round((suggestion?.confidence_score ?? 0) * 100)}%`
        : (callError ?? null),
      payload: {
        provider, model,
        request_type: suggestion?.request_type ?? null,
        cost_usd: costUsd,
        duration_ms: durationMs,
      },
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
