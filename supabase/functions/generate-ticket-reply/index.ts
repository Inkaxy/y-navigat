// Genererer et AI-svarutkast på en ticket basert på epost-tråd, AI-analyse,
// koblet ordre, produkter og hentested. Returnerer alltid et REDIGERBART utkast
// (body_text + body_html). Sender ingenting selv.
//
// Body: {
//   ticket_id: string,
//   reply_type: "clarify" | "reply" | "change" | "cancellation" | "polite_decline",
//   tone?: ("kort" | "vennlig" | "profesjonell" | "tydelig")[],
//   language?: "auto" | "nb" | "en",
//   extra_instructions?: string
// }
//
// Krever innlogget bruker med ordre-skrivetilgang.

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

const REPLY_TYPES = ["clarify", "reply", "change", "cancellation", "polite_decline"] as const;
const TONES = ["kort", "vennlig", "profesjonell", "tydelig"] as const;

const InputSchema = z.object({
  ticket_id: z.string().uuid(),
  reply_type: z.enum(REPLY_TYPES),
  tone: z.array(z.enum(TONES)).default(["vennlig", "profesjonell", "tydelig"]),
  language: z.enum(["auto", "nb", "en"]).default("auto"),
  extra_instructions: z.string().max(2000).optional(),
});

const ResultSchema = z.object({
  language: z.enum(["nb", "en"]),
  subject_suggestion: z.string().nullable().optional(),
  body_text: z.string(),
  body_html: z.string(),
});

const REPLY_TYPE_INSTRUCTION_NB: Record<typeof REPLY_TYPES[number], string> = {
  clarify:
    "Skriv en kort avklaringsmail. Still presise spørsmål for å hente inn manglende informasjon (se 'Mangler info'-listen). Ikke bekreft noe vi ikke vet ennå.",
  reply:
    "Skriv et generelt svar til kunden basert på epost-innholdet og AI-sammendraget. Bekreft det vi vet, vær tydelig på hva som mangler eller hva neste steg er.",
  change:
    "Skriv en bekreftelse på endringen kunden har bedt om. Beskriv konkret hva som er endret på ordren (felt + ny verdi). Hvis noe ikke kan endres, si fra på en høflig måte.",
  cancellation:
    "Skriv en bekreftelse på at ordren er kansellert. Vær empatisk, tydelig og kort. Nevn ordrenummer og hentedato hvis tilgjengelig.",
  polite_decline:
    "Skriv et høflig avslag eller foreslå et alternativ. Forklar kort hvorfor vi ikke kan imøtekomme ønsket (f.eks. kapasitet, leveringstid, sortiment), og tilby et realistisk alternativ hvis mulig.",
};

const REPLY_TYPE_INSTRUCTION_EN: Record<typeof REPLY_TYPES[number], string> = {
  clarify:
    "Write a short clarification email. Ask precise questions to collect the missing information (see 'missing info' list). Do not confirm anything we don't yet know.",
  reply:
    "Write a general reply to the customer based on the email content and the AI summary. Confirm what we know, be clear about what's missing or what the next step is.",
  change:
    "Write a confirmation of the change the customer requested. Describe concretely what was changed on the order (field + new value). If something cannot be changed, say so politely.",
  cancellation:
    "Write a confirmation that the order has been cancelled. Be empathetic, clear and short. Mention the order number and pickup date if available.",
  polite_decline:
    "Write a polite decline or propose an alternative. Briefly explain why we cannot fulfil the request (e.g. capacity, lead time, assortment) and offer a realistic alternative if possible.",
};

function detectLanguage(text: string | null | undefined): "nb" | "en" {
  if (!text) return "nb";
  const t = text.toLowerCase();
  // Norske særtegn eller vanlige norske småord
  if (/[æøå]/.test(t)) return "nb";
  const nbHits = (t.match(/\b(og|ikke|hei|takk|hilsen|kake|bestilling|levering|hentested|fredag|tirsdag|tusen|venn(lig)?)\b/g) ?? []).length;
  const enHits = (t.match(/\b(the|and|please|thanks|regards|order|delivery|pickup|cake|tomorrow|hello|hi)\b/g) ?? []).length;
  if (enHits > nbHits) return "en";
  return "nb";
}

function trimEmailBody(text: string | null | undefined, max = 4000): string {
  if (!text) return "";
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n--+\s*Original Message\s*--+|\n_{5,}|\nFra:\s/i)[0]
    .trim()
    .slice(0, max);
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function textToHtml(text: string): string {
  const paras = text.split(/\n{2,}/).map((p) => `<p>${htmlEscape(p).replace(/\n/g, "<br/>")}</p>`).join("");
  return paras;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const startTs = Date.now();

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return jsonErr("Missing Authorization", 401);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return jsonErr("Not authenticated", 401);
    const userId = userRes.user.id;

    const { data: hasWrite } = await userClient.rpc("has_app_write_access", { p_app_code: "ordre" });
    if (!hasWrite) return jsonErr("Forbidden — mangler skrivetilgang på ordre", 403);

    const parsed = InputSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return jsonErr("Ugyldig input", 400, { details: parsed.error.flatten() });
    const { ticket_id, reply_type, tone, language, extra_instructions } = parsed.data;

    // --- Hent ticket ---
    const { data: ticket } = await admin
      .from("tickets")
      .select("id,subject,sender_name,sender_email,body_text,body_preview,ai_suggestion,related_order_id,received_at")
      .eq("id", ticket_id).maybeSingle();
    if (!ticket) return jsonErr("Ticket ikke funnet", 404);

    // --- Hent tidligere svar (kort kontekst, siste 3) ---
    const { data: replies } = await admin
      .from("ticket_replies")
      .select("body_text,sent_at,created_at,send_status")
      .eq("ticket_id", ticket_id)
      .eq("send_status", "sent")
      .order("created_at", { ascending: false })
      .limit(3);

    // --- Hent ordre + linjer + hentested hvis koblet ---
    let order: any = null;
    let orderLines: any[] = [];
    let pickup: any = null;
    if (ticket.related_order_id) {
      const { data: o } = await admin.from("orders")
        .select("id,order_number,status,delivery_date,delivery_time,customer_snapshot,delivery_address_line1,delivery_postal_code,delivery_city,customer_notes,pickup_location_id")
        .eq("id", ticket.related_order_id).maybeSingle();
      order = o;
      if (o) {
        const { data: lines } = await admin.from("order_lines")
          .select("line_number,quantity,product_snapshot,notes")
          .eq("order_id", o.id).order("line_number", { ascending: true });
        orderLines = lines ?? [];
        if (o.pickup_location_id) {
          const { data: p } = await admin.from("pickup_locations")
            .select("display_name,city,address_line1,opening_hours")
            .eq("id", o.pickup_location_id).maybeSingle();
          pickup = p;
        }
      }
    }

    // --- Hent platform settings: signatur + alle hentesteder (fallback-kontekst) ---
    const { data: settingsRows } = await admin
      .from("platform_settings").select("key,value")
      .in("category", ["ordre_ai", "ordre_email"]);
    const settings = Object.fromEntries((settingsRows ?? []).map((r: any) => [r.key, r.value]));

    const provider = (settings.ai_provider?.provider ?? "anthropic") as "anthropic" | "openai";
    const models = settings.ai_models ?? {};
    const model = (models.main ?? (provider === "anthropic" ? "claude-sonnet-4-5" : "gpt-4o")) as string;
    const pricing = settings.ai_pricing ?? {};
    const apiKey = (Deno.env.get(provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY") ?? "").trim();
    if (!apiKey) return jsonErr(`Provider ${provider} er ikke konfigurert (mangler API-nøkkel-secret)`, 503);

    const { data: pickupsAll } = await admin.from("pickup_locations")
      .select("display_name,city,opening_hours")
      .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
      .eq("status", "active").limit(20);

    // --- Språk ---
    const detectedLanguage = language === "auto"
      ? detectLanguage(ticket.body_text ?? ticket.body_preview ?? "")
      : language;

    // --- Bygg prompt ---
    const bodyText = trimEmailBody(ticket.body_text ?? ticket.body_preview ?? "");
    const sugg = ticket.ai_suggestion as any | null;

    const orderBlock = order ? {
      order_number: order.order_number,
      status: order.status,
      delivery_date: order.delivery_date,
      delivery_time: order.delivery_time,
      customer_name: order.customer_snapshot?.display_name ?? null,
      delivery_address: [order.delivery_address_line1, order.delivery_postal_code, order.delivery_city].filter(Boolean).join(", ") || null,
      customer_notes: order.customer_notes,
      lines: orderLines.map((l) => ({
        n: l.line_number,
        qty: l.quantity,
        product: l.product_snapshot?.display_name ?? l.product_snapshot?.name ?? null,
        notes: l.notes,
      })),
      pickup_location: pickup ? {
        name: pickup.display_name,
        city: pickup.city,
        address: pickup.address_line1,
        opening_hours: pickup.opening_hours ?? null,
      } : null,
    } : null;

    const aiSummaryBlock = sugg ? {
      request_type: sugg.request_type,
      summary: sugg.summary,
      missing_info: sugg.missing_info ?? [],
      risks: sugg.risks ?? [],
      change_intent: sugg.change_intent ?? null,
      order_fields: sugg.order_fields ?? null,
      products: sugg.products ?? [],
    } : null;

    const repliesBlock = (replies ?? []).reverse().map((r) => r.body_text).filter(Boolean).slice(0, 3);

    const isNb = detectedLanguage === "nb";
    const replyInstruction = (isNb ? REPLY_TYPE_INSTRUCTION_NB : REPLY_TYPE_INSTRUCTION_EN)[reply_type];

    const toneList = tone.join(", ");
    const senderFirstName = (ticket.sender_name ?? "").split(/\s+/)[0] || null;
    const greetingHint = isNb
      ? (senderFirstName ? `Bruk hilsen "Hei ${senderFirstName}," hvis det er naturlig.` : `Bruk hilsen "Hei," hvis det er naturlig.`)
      : (senderFirstName ? `Use greeting "Hi ${senderFirstName}," if appropriate.` : `Use greeting "Hi," if appropriate.`);

    const signOffHint = isNb
      ? `Avslutt med "Vennlig hilsen\\nNøtterø Bakeri" (ikke skriv personnavn — saksbehandleren legger til sitt eget navn).`
      : `Sign off with "Kind regards,\\nNøtterø Bakeri" (do not invent a personal name — the staff member will add their own).`;

    const systemPrompt = isNb
      ? `Du er saksbehandler-assistent for ordrekontoret ved Nøtterø Bakeri. Du skriver alltid utkast som en menneskelig saksbehandler skal lese gjennom, redigere og sende.

Tone of voice: ${toneList}. Skriv naturlig norsk — IKKE "AI-aktig", ingen overflødige høflighetsfraser, ingen tomme bekreftelser, ingen emojier. Kortest mulig uten å miste det viktige. ${greetingHint} ${signOffHint}

Returner KUN gyldig JSON som matcher dette schemaet (ingen markdown):
{
  "language": "nb",
  "subject_suggestion": string | null,
  "body_text": string,   // ren tekst med vanlige linjeskift
  "body_html": string    // enkel HTML: <p>, <br/>, evt. <ul><li>
}

Regler:
- Ikke finn på fakta. Hvis du ikke vet noe, spør eller la det stå åpent.
- Bruk ordre-data og hentested fra konteksten der det er relevant.
- Maks ~180 ord.
- ${replyInstruction}`
      : `You are an order-desk assistant at Nøtterø Bakeri (a Norwegian bakery). You always produce drafts that a human will review, edit and send.

Tone of voice: ${toneList}. Write natural English — NOT "AI-like", no filler politeness, no empty confirmations, no emojis. As short as possible without losing what matters. ${greetingHint} ${signOffHint}

Return ONLY valid JSON matching this schema (no markdown):
{
  "language": "en",
  "subject_suggestion": string | null,
  "body_text": string,   // plain text with normal line breaks
  "body_html": string    // simple HTML: <p>, <br/>, optionally <ul><li>
}

Rules:
- Do not invent facts. If you don't know something, ask or leave it open.
- Use the order data and pickup location from the context where relevant.
- Max ~180 words.
- ${replyInstruction}`;

    const userText = JSON.stringify({
      reply_type,
      detected_language: detectedLanguage,
      tone,
      ticket: {
        subject: ticket.subject,
        from: ticket.sender_email,
        from_name: ticket.sender_name,
        received_at: ticket.received_at,
        body: bodyText,
      },
      previous_replies_from_us: repliesBlock,
      ai_analysis: aiSummaryBlock,
      linked_order: orderBlock,
      known_pickup_locations: pickupsAll ?? [],
      extra_instructions: extra_instructions ?? null,
    }, null, 2);

    let rawText = "";
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let callError: string | null = null;
    let callStatus: "success" | "error" | "rate_limited" = "success";

    try {
      const res = await callAi({
        provider, apiKey, model,
        maxTokens: 1500,
        temperature: 0.4,
        systemPrompt,
        userText,
      });
      rawText = res.rawText;
      inputTokens = res.inputTokens;
      outputTokens = res.outputTokens;
    } catch (e) {
      callError = (e as Error).message;
      if (/credit balance|insufficient.?credit|quota|billing/i.test(callError)) {
        callError = `${provider} har ikke nok kreditt. Fyll på kreditt eller bytt provider i Innstillinger → AI.`;
        callStatus = "error";
      } else if (/rate.?limit|429/i.test(callError)) {
        callStatus = "rate_limited";
      } else {
        callStatus = "error";
      }
    }

    let result: z.infer<typeof ResultSchema> | null = null;
    if (callStatus === "success") {
      try {
        const cleaned = rawText.replace(/```(?:json)?\s*/g, "").replace(/```\s*$/, "").trim();
        const json = JSON.parse(cleaned);
        if (!json.language) json.language = detectedLanguage;
        if (!json.body_html && json.body_text) json.body_html = textToHtml(json.body_text);
        if (!json.body_text && json.body_html) {
          json.body_text = json.body_html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n").replace(/<[^>]+>/g, "").trim();
        }
        const parsedResult = ResultSchema.safeParse(json);
        if (!parsedResult.success) {
          callStatus = "error";
          callError = "AI returnerte ugyldig JSON-struktur: " + JSON.stringify(parsedResult.error.flatten()).slice(0, 400);
        } else {
          result = parsedResult.data;
        }
      } catch (e) {
        callStatus = "error";
        callError = "Kunne ikke parse AI-respons: " + (e as Error).message;
      }
    }

    const durationMs = Date.now() - startTs;
    let costUsd: number | null = null;
    const priceCfg = pricing?.[provider]?.[model];
    if (priceCfg && inputTokens != null && outputTokens != null) {
      costUsd = (inputTokens * (priceCfg.input_per_1m ?? 0) + outputTokens * (priceCfg.output_per_1m ?? 0)) / 1_000_000;
    } else {
      costUsd = estimateCostUsd(model, inputTokens, outputTokens);
    }

    await admin.from("ai_call_log").insert({
      ticket_id,
      triggered_by: userId,
      provider, model,
      status: callStatus,
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      cost_usd: costUsd,
      duration_ms: durationMs,
      error: callError,
      request_payload: {
        purpose: "generate_ticket_reply",
        reply_type, tone, language: detectedLanguage,
        has_order: !!order,
      },
      response_payload: result ? {
        language: result.language,
        body_length: result.body_text.length,
      } : null,
    }).then(() => {}, () => {});

    if (callStatus !== "success" || !result) {
      return jsonErr(callError ?? "AI-kall feilet", 502, { status: callStatus });
    }

    return new Response(JSON.stringify({
      ok: true,
      draft: result,
      detected_language: detectedLanguage,
      reply_type,
      tone,
      cost_usd: costUsd,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-ticket-reply error", e);
    return jsonErr((e as Error).message ?? "error", 500);
  }
});
