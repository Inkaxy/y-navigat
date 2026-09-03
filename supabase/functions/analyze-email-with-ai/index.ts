// Analyserer en ticket-epost med valgt AI-provider, returnerer strukturert ordre-forslag (v2).
// Lagrer på tickets.ai_suggestion + ai_call_log.
// Støtter både frontend-kall (bruker-JWT) og interne service-kall (fra andre edge-funksjoner).

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { callAi, estimateCostUsd } from "../_shared/ai-providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-internal-service",
};

const FALLBACK_LEGAL_ENTITY_ID = "751709bc-04b3-4449-867d-b97faa9ab373";
const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com","hotmail.com","hotmail.no","outlook.com","outlook.no",
  "yahoo.com","yahoo.no","live.com","live.no","icloud.com","me.com",
  "online.no","start.no","broadpark.no","getmail.no",
]);

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
  "new_order","change","cancellation","question","complaint","internal","unclear","spam",
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
    product_id: z.string().uuid().nullable().optional().default(null),
    product_name: z.string().nullable().optional().default("").transform((v) => v ?? ""),
    quantity: z.coerce.number().nullable().optional().default(1).transform((v) => (v == null || Number.isNaN(v) ? 1 : v)),
    size_or_servings: z.string().nullable().optional(),
    flavor: z.string().nullable().optional(),
    filling: z.string().nullable().optional(),
    decoration: z.string().nullable().optional(),
    match_confidence: z.coerce.number().min(0).max(1).nullable().optional().default(0.5).transform((v) => (v == null || Number.isNaN(v) ? 0.5 : v)),
  })).default([]),
  missing_info: z.array(z.object({ code: z.string(), label: z.string() })).default([]),
  risks: z.array(z.object({
    severity: z.enum(["red","yellow","green"]), code: z.string(), message: z.string(),
  })).default([]),
  field_confidence: z.record(z.number().min(0).max(1)).default({}),
  reasoning_per_field: z.record(z.string()).default({}),
  tour: z.object({ tour_id: z.string().uuid().nullable(), tour_name: z.string().nullable() }).nullable().optional(),
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
  delivery_date: z.string().nullable().optional(),
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
    // Tilgangssjekk: internt service-kall ELLER bruker-JWT med app-tilgang
    const internalHeader = req.headers.get("x-internal-service") ?? "";
    const isInternal = internalHeader && internalHeader === serviceKey;

    let userId: string | null = null;
    const admin = createClient(supabaseUrl, serviceKey);

    if (!isInternal) {
      const auth = req.headers.get("Authorization");
      if (!auth) return jsonErr("Missing Authorization", 401);
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: auth } },
      });
      const { data: userRes } = await userClient.auth.getUser();
      if (!userRes?.user) return jsonErr("Not authenticated", 401);
      userId = userRes.user.id;

      const { data: hasAccess } = await userClient.rpc("has_ordre_settings_access");
      if (!hasAccess) {
        const { data: hasWrite } = await userClient.rpc("has_app_write_access", { p_app_code: "ordre" });
        if (!hasWrite) return jsonErr("Forbidden", 403);
      }
    }

    const parsed = InputSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return jsonErr("Ugyldig input", 400, { details: parsed.error.flatten() });
    const { ticket_id, force } = parsed.data;

    const { data: ticket, error: tErr } = await admin
      .from("tickets").select("*").eq("id", ticket_id).maybeSingle();
    if (tErr) throw tErr;
    if (!ticket) return jsonErr("Ticket ikke funnet", 404);

    if (ticket.ai_analyzed_at && ticket.ai_suggestion && !ticket.ai_error && !force) {
      return new Response(JSON.stringify({ ok: true, cached: true, analysis: ticket.ai_suggestion }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: settingsRows } = await admin
      .from("platform_settings").select("key,value").eq("category", "ordre_ai");
    const settings = Object.fromEntries((settingsRows ?? []).map((r: any) => [r.key, r.value]));
    const provider = (settings.ai_provider?.provider ?? "openai") as "anthropic" | "openai";
    const models = settings.ai_models ?? {};
    const model = (models.main ?? (provider === "anthropic" ? "claude-sonnet-4-5" : "gpt-4o")) as string;
    const screeningModel = (models.screening ?? (provider === "anthropic" ? "claude-3-5-haiku-20241022" : "gpt-4o-mini")) as string;
    const pricing = settings.ai_pricing ?? {};

    // Resolve legal_entity_id fra source_mailbox via platform_settings-mapping
    const mailboxMap = (settings.mailbox_legal_entity_map ?? {}) as Record<string, string>;
    const sourceMailbox = (ticket.source_mailbox ?? "").toLowerCase().trim();
    const legalEntityId = mailboxMap[sourceMailbox] ?? FALLBACK_LEGAL_ENTITY_ID;

    const apiKey = (Deno.env.get(provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY") ?? "").trim();
    if (!apiKey) {
      return jsonErr(`Provider ${provider} er ikke konfigurert (mangler API-nøkkel-secret)`, 503);
    }

    // === STEG 1: Kundematch i flere lag ===
    const senderEmail = (ticket.sender_email ?? "").toLowerCase().trim();
    const senderDomain = senderEmail.includes("@") ? senderEmail.split("@")[1] : "";
    const rawBody = (ticket.body_text ?? ticket.body_preview ?? "").slice(0, 8000);
    const bodyPlusSubject = `${ticket.subject ?? ""}\n${rawBody}`;

    const orderNumberMatches = Array.from(
      bodyPlusSubject.matchAll(/(?:ordre\w*\s*(?:nr|nummer)?\s*[:#]?\s*|#)\s*(\d{2,4}[-\s]?\d{3,6})/gi),
    ).map((m) => m[1].replace(/\s/g, "").replace(/^(\d{2,4})(\d{3,6})$/, "$1-$2"));

    const matchedCustomerIds = new Set<string>();
    const matchReasons: string[] = [];

    // Lag 1: eksakt e-post mot customers.primary_contact_email
    if (senderEmail) {
      const { data: byEmail } = await admin.from("customers")
        .select("id,display_name,customer_number,primary_contact_email,primary_contact_phone,mobile_phone")
        .eq("legal_entity_id", legalEntityId)
        .eq("status", "active")
        .eq("primary_contact_email", senderEmail)
        .limit(5);
      for (const c of byEmail ?? []) { matchedCustomerIds.add(c.id); matchReasons.push(`email→${c.display_name}`); }
    }

    // Lag 2: customer_contacts.email
    if (senderEmail) {
      const { data: byContact } = await admin.from("customer_contacts")
        .select("customer_id,email")
        .ilike("email", senderEmail)
        .limit(10);
      for (const c of byContact ?? []) if (c.customer_id) { matchedCustomerIds.add(c.customer_id); matchReasons.push(`kontakt-email`); }
    }

    // Lag 3: domene-match (kun ikke-generiske domener)
    if (senderDomain && !GENERIC_EMAIL_DOMAINS.has(senderDomain) && matchedCustomerIds.size === 0) {
      const { data: byDomain } = await admin.from("customers")
        .select("id,display_name,primary_contact_email")
        .eq("legal_entity_id", legalEntityId)
        .eq("status", "active")
        .ilike("primary_contact_email", `%@${senderDomain}`)
        .limit(10);
      for (const c of byDomain ?? []) { matchedCustomerIds.add(c.id); matchReasons.push(`domene→${c.display_name}`); }
    }

    // Lag 4: ordrenummer-regex → resolve customer_id
    if (orderNumberMatches.length > 0) {
      const { data: byOrderNr } = await admin.from("orders")
        .select("customer_id,order_number")
        .eq("legal_entity_id", legalEntityId)
        .in("order_number", orderNumberMatches);
      for (const o of byOrderNr ?? []) if (o.customer_id) {
        matchedCustomerIds.add(o.customer_id); matchReasons.push(`ordrenr ${o.order_number}`);
      }
    }

    // Hent full kandidat-kundeliste for AI-en
    let candidateCustomers: any[] = [];
    if (matchedCustomerIds.size > 0) {
      const { data: rows } = await admin.from("customers")
        .select("id,display_name,customer_number,primary_contact_email,primary_contact_phone,mobile_phone")
        .in("id", Array.from(matchedCustomerIds));
      candidateCustomers = rows ?? [];
    }
    // Hvis ingen treff: gi AI-en en liten fallback-liste basert på navnesøk fra ticket
    if (candidateCustomers.length === 0) {
      const { data: fallback } = await admin.from("customers")
        .select("id,display_name,customer_number,primary_contact_email,primary_contact_phone,mobile_phone")
        .eq("legal_entity_id", legalEntityId)
        .eq("status", "active")
        .limit(50);
      candidateCustomers = fallback ?? [];
    }

    const [{ data: pickups }] = await Promise.all([
      admin.from("pickup_locations")
        .select("id,display_name,city")
        .eq("legal_entity_id", legalEntityId)
        .eq("status", "active")
        .limit(50),
    ]);

    // === STEG 2: Kandidat-ordre ===
    const today = new Date(); today.setHours(0,0,0,0);
    const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 60);
    const cutoffISO = cutoff.toISOString().slice(0,10);
    const activeStatuses = ["draft","awaiting_confirmation","confirmed","in_production","packed","on_hold"];
    let candidateOrdersRaw: any[] = [];
    if (matchedCustomerIds.size > 0 || orderNumberMatches.length > 0) {
      let q = admin.from("orders")
        .select("id,order_number,status,delivery_date,delivery_time,customer_id,customer_snapshot,delivery_address_line1,delivery_postal_code,delivery_city,customer_notes,internal_notes")
        .eq("legal_entity_id", legalEntityId)
        .gte("delivery_date", cutoffISO)
        .in("status", activeStatuses)
        .order("delivery_date", { ascending: true })
        .limit(20);
      const orFilters: string[] = [];
      if (matchedCustomerIds.size > 0) orFilters.push(`customer_id.in.(${Array.from(matchedCustomerIds).join(",")})`);
      for (const onr of orderNumberMatches) orFilters.push(`order_number.eq.${onr}`);
      if (orFilters.length > 0) q = q.or(orFilters.join(","));
      const { data: cand } = await q;
      candidateOrdersRaw = cand ?? [];
    }
    const candIds = candidateOrdersRaw.map((o: any) => o.id);
    const linesByOrder: Record<string, any[]> = {};
    if (candIds.length > 0) {
      const { data: lines } = await admin.from("order_lines")
        .select("order_id,line_number,quantity,product_snapshot,notes")
        .in("order_id", candIds)
        .order("line_number", { ascending: true });
      for (const l of lines ?? []) (linesByOrder[l.order_id] = linesByOrder[l.order_id] || []).push(l);
    }

    const bodyText = trimEmailBody(ticket.body_text ?? ticket.body_preview ?? "");
    const todayISO = new Date().toISOString().slice(0, 10);

    // === STEG 3: PASS 1 – AI-uttrekk av produktnavn ===
    let extractedProductNames: Array<{ name: string; quantity?: number; note?: string }> = [];
    let pass1InputTok = 0, pass1OutputTok = 0;
    try {
      const extractSystem = `Du får en e-post til et bakeri. Trekk ut alle produkter/varer kunden nevner (kaker, brød, kringler, snitter osv.).
Returner KUN JSON: { "items": [ { "name": string (norsk vare-navn slik det står), "quantity": number|null, "note": string|null } ] }.
Ingen forklaringer, ingen markdown.`;
      const extractUser = `Emne: ${ticket.subject ?? ""}\n\n${bodyText}`;
      const r = await callAi({
        provider, apiKey, model: screeningModel, maxTokens: 512, temperature: 0,
        systemPrompt: extractSystem, userText: extractUser,
      });
      pass1InputTok = r.inputTokens ?? 0; pass1OutputTok = r.outputTokens ?? 0;
      const cleaned = r.rawText.replace(/```(?:json)?\s*/g, "").replace(/```\s*$/, "").trim();
      const parsedItems = JSON.parse(cleaned);
      if (Array.isArray(parsedItems?.items)) {
        extractedProductNames = parsedItems.items
          .filter((x: any) => x && typeof x.name === "string" && x.name.trim().length > 0)
          .slice(0, 15);
      }
    } catch (e) {
      console.warn("Pass 1 (produkt-uttrekk) feilet:", (e as Error).message);
    }

    // === Trgm-søk per uttrekk ===
    const productCandidatesPerItem: Array<{ query: string; quantity?: number; candidates: any[] }> = [];
    for (const item of extractedProductNames) {
      const { data: cands } = await admin.rpc("search_products_trgm", {
        p_legal_entity_id: legalEntityId,
        p_query: item.name,
        p_limit: 10,
      });
      productCandidatesPerItem.push({
        query: item.name,
        quantity: item.quantity,
        candidates: (cands ?? []) as any[],
      });
    }

    // === STEG 4: PASS 2 – hovedanalyse ===
    const systemPrompt = `Du er en assistent som leser e-post sendt til Nøtterø Bakeri sitt ordrekontor og lager en strukturert analyse for en saksbehandler.

Dagens dato: ${todayISO}.

Returner KUN gyldig JSON som matcher schemaet (ingen markdown, ingen tekst rundt):
{
  "request_type": "new_order"|"change"|"cancellation"|"question"|"complaint"|"internal"|"unclear"|"spam",
  "summary": string,
  "suggested_action": string,
  "customer_match": { "customer_id": uuid|null, "customer_name": string|null, "match_confidence": 0..1 } | null,
  "order_fields": {
    "delivery_date": "YYYY-MM-DD"|null, "delivery_time": "HH:MM"|null,
    "pickup_location_hint": string|null,
    "delivery_address_line1": string|null, "delivery_address_line2": string|null,
    "delivery_postal_code": string|null, "delivery_city": string|null,
    "customer_notes": string|null, "internal_notes": string|null,
    "production_notes": string|null, "store_notes": string|null,
    "cake_text": string|null, "allergies": string|null, "special_requests": string|null,
    "contact_phone": string|null, "contact_email": string|null
  },
  "products": [{ "product_id": uuid|null, "product_name": string, "quantity": number, "size_or_servings": string|null, "flavor": string|null, "filling": string|null, "decoration": string|null, "match_confidence": 0..1 }],
  "missing_info": [{ "code": string, "label": string }],
  "risks": [{ "severity": "red"|"yellow"|"green", "code": string, "message": string }],
  "field_confidence": {}, "reasoning_per_field": {},
  "candidate_orders": [{ "order_id": uuid, "order_number": string|null, "match_confidence": 0..1, "why_match": string, "snapshot": {...} }],
  "referenced_order": { "order_id": uuid, "order_number": string|null, "match_confidence": 0..1 } | null,
  "change_intent": { "target_order_id": uuid|null, "changes": [...], "cancellation_reason": string|null } | null,
  "confidence_score": 0..1, "reasoning": string
}

Regler:
- products[].product_id MÅ velges fra PRODUKT-KANDIDATER-lista under, eller settes til null hvis ingen kandidat er god nok (< ~0.4 similarity, eller ingen matcher intensjonen).
- customer_match.customer_id skal være en av id-ene fra KUNDE-KANDIDATER, eller null.
- candidate_orders / referenced_order / change_intent: bruk EKSAKTE order_id fra KANDIDAT-ORDRE.
- Norsk datoformat DD-MM-YYYY inn; delivery_date ut skal være ISO YYYY-MM-DD.
- ALL tekst som vises til saksbehandler skal være på norsk bokmål: summary, suggested_action, reasoning, why_match, missing_info[].label, risks[].message og alle notat-felt. Kun de tekniske kodene (request_type, missing_info[].code, risks[].code, risks[].severity) beholdes på engelsk.
- summary skal være 1–2 korte setninger på norsk uten engelske ord som "Order", "Change", "Customer" eller "Delivery".

PRODUCTION_NOTES: kort tekst til bakeriet med Felt: verdi per linje. STORE_NOTES: kort tekst til utleveringsstedet. Sett null hvis intet relevant.`;

    const productBlock = productCandidatesPerItem.length === 0
      ? "(AI fant ingen produktnavn i e-posten)"
      : productCandidatesPerItem.map((it, i) => {
          const header = `Item ${i+1}: "${it.query}"${it.quantity ? ` (antall ${it.quantity})` : ""}`;
          const rows = it.candidates.length === 0
            ? "  (ingen trgm-kandidater)"
            : it.candidates.map((c: any) =>
                `  ${c.id} | ${c.display_number ?? ""} | ${c.display_name} | ${c.unit_of_sale ?? ""} | sim=${Number(c.similarity ?? 0).toFixed(2)}`).join("\n");
          return `${header}\n${rows}`;
        }).join("\n\n");

    const userText = [
      `=== TICKET ===`,
      `Emne: ${ticket.subject ?? ""}`,
      `Avsender: ${ticket.sender_name ?? ""} <${ticket.sender_email ?? ""}>`,
      `Mottatt: ${ticket.received_at ?? ""}`,
      `Kunde-match-hint: ${matchReasons.join("; ") || "(ingen forhåndsmatch)"}`,
      ``,
      `--- E-post-tekst ---`,
      bodyText,
      ``,
      `=== KUNDE-KANDIDATER (id | kundenr | navn | epost | telefon) ===`,
      candidateCustomers.map((c: any) => `${c.id} | ${c.customer_number ?? ""} | ${c.display_name} | ${c.primary_contact_email ?? ""} | ${c.primary_contact_phone ?? c.mobile_phone ?? ""}`).join("\n"),
      ``,
      `=== PRODUKT-KANDIDATER (fra pg_trgm-søk, sortert på similarity) ===`,
      productBlock,
      ``,
      `=== HENTESTEDER (navn | by) ===`,
      (pickups ?? []).map((p: any) => `${p.display_name} | ${p.city ?? ""}`).join("\n"),
      ``,
      `=== KANDIDAT-ORDRE (order_id | ordrenr | status | hentedato | hentetid | kunde | linjer | kundenotat | adresse) ===`,
      candidateOrdersRaw.length === 0
        ? "(ingen aktive/fremtidige ordre funnet)"
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
        provider, apiKey, model, maxTokens: 3072, temperature: 0.1,
        systemPrompt, userText,
      });
      rawText = result.rawText;
      inputTokens = (result.inputTokens ?? 0) + pass1InputTok;
      outputTokens = (result.outputTokens ?? 0) + pass1OutputTok;
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
        if (json && Array.isArray(json.products)) {
          json.products = json.products
            .filter((p: unknown) => p && typeof p === "object")
            .map((p: any) => ({
              product_id: typeof p.product_id === "string" ? p.product_id : null,
              product_name: p.product_name ?? p.name ?? p.title ?? "",
              quantity: p.quantity ?? p.qty ?? p.count ?? 1,
              size_or_servings: p.size_or_servings ?? p.size ?? null,
              flavor: p.flavor ?? null,
              filling: p.filling ?? null,
              decoration: p.decoration ?? null,
              match_confidence: p.match_confidence ?? p.confidence ?? 0.5,
            }));
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
        legal_entity_id: legalEntityId,
        customer_candidates: candidateCustomers.length,
        product_items_extracted: extractedProductNames.length,
        pickups_count: pickups?.length ?? 0,
        internal_invoke: isInternal,
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

    await admin.from("ticket_events").insert({
      ticket_id,
      order_id: ticket.related_order_id ?? null,
      event_type: callStatus === "success" ? "ai.analysis_completed" : "ai.analysis_failed",
      actor_type: "ai",
      actor_user_id: userId,
      actor_label: `${provider}/${model}`,
      summary: callStatus === "success"
        ? `${suggestion?.request_type ?? "?"} · konfidens ${Math.round((suggestion?.confidence_score ?? 0) * 100)}%`
        : (callError ?? null),
      payload: {
        provider, model,
        request_type: suggestion?.request_type ?? null,
        cost_usd: costUsd,
        duration_ms: durationMs,
        internal_invoke: isInternal,
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
