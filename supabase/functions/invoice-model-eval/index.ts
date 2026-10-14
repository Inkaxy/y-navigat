// Adminbeskyttet, SKRIVEBESKYTTET modellsammenligning for fakturalesing.
//
// Én faktura og én modell per kall. Leser lagret original-PDF via
// rm_invoice_document_version (brukerens tilgang + selskapssti), kjører samme
// prompt/schema/kontrollfakta som fakturaleseren med ett forsøk (ingen skjult nytt
// forsøk), og returnerer modell, faktisk forbruk, anslått kostnad eller ukjent,
// svartid, lest innhold og deterministiske kontrollfeil.
//
// Skriver ALDRI til faktura, linjer, pris eller modelloppsett. Eneste skriving er
// en rad i ai_usage_log (purpose=invoice_model_eval).

import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { formatPdfTextForModel, pdfTextProfile } from "../_shared/pdfText.ts";
import { readOriginalPdfText } from "../_shared/pdfTextRuntime.ts";
import { decryptWithKey } from "../_shared/crypto.ts";
import { AiCallError, callAi, COST_RATE_VERSION, extractJson, estimateCostUsd, hasCachedRate, usageOf, type AiCallResult, type AiUsage } from "../_shared/ai-providers.ts";
import { runExtractionAttempts, type Hints, type LearningExample } from "../_shared/invoiceExtraction.ts";
import { INVOICE_EXTRACTION_SYSTEM_PROMPT } from "../_shared/invoiceExtractionPrompt.ts";
import { scoreAgainstFasit } from "../_shared/evalFasit.ts";
import { deterministicChecks, EVAL_LIMITS, INVOICE_EXTRACTION_SCHEMA, INVOICE_EXTRACTION_SCHEMA_VERSION, isEvalModel } from "../_shared/modelEval.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const err = (code: string, message: string, status: number) => json({ error: { code, message } }, status);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("method", "Bare POST", 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    // Ingen tjenestekall: evalen kjøres bare av en innlogget administrator.
    if (!token || token === serviceKey || token === anonKey) return err("unauthorized", "Innlogging kreves", 401);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return err("unauthorized", "Innlogging kreves", 401);
    const { data: isAdmin, error: adminErr } = await userClient.rpc("is_platform_admin");
    if (adminErr || isAdmin !== true) return err("forbidden", "Bare administratorer kan sammenligne modeller", 403);

    const body = await req.json().catch(() => ({})) as { invoice_id?: unknown; model?: unknown };
    if (typeof body.invoice_id !== "string" || !UUID.test(body.invoice_id)) return err("invalid", "invoice_id må være en gyldig id", 400);
    if (!isEvalModel(body.model)) return err("invalid_model", "Modellen er ikke tillatt i sammenligningen", 400);
    const model = body.model;

    // Fakturaen leses med brukerens rettigheter (RLS).
    const { data: inv } = await userClient.from("invoices")
      .select("id, legal_entity_id, supplier_id, invoice_number, total_amount, total_vat, is_credit_note, suppliers(name)")
      .eq("id", body.invoice_id).maybeSingle();
    if (!inv?.legal_entity_id) return err("not_found", "Fakturaen finnes ikke eller er ikke tilgjengelig", 404);
    const le = inv.legal_entity_id as string;
    const { data: canRead } = await userClient.rpc("has_ravarer_invoice_access", { _legal_entity_id: le, _required_level: "read" });
    if (canRead !== true) return err("forbidden", "Mangler tilgang til fakturaen", 403);

    // Original: validert sti via eksisterende RPC (tilgang + selskapssti), kontroll før og etter nedlasting.
    const { data: dv, error: dvErr } = await userClient.rpc("rm_invoice_document_version", { p_invoice_id: inv.id });
    const doc = dv as { available?: boolean; path?: string; version?: string; reason?: string } | null;
    if (dvErr || !doc) return err("document_unknown", "Kunne ikke kontrollere originalen", 503);
    if (!doc.available || !doc.path || !doc.version) return err("document_missing", "Fakturaen har ingen lagret original-PDF", 422);
    const { data: blob, error: dlErr } = await admin.storage.from("invoice-pdfs").download(doc.path);
    if (dlErr || !blob) return err("document_unknown", "Kunne ikke laste ned originalen", 503);
    if (blob.size > EVAL_LIMITS.maxPdfBytes) return err("document_too_large", "Originalen er for stor for sammenligning", 413);
    const { data: dv2 } = await userClient.rpc("rm_invoice_document_version", { p_invoice_id: inv.id });
    if ((dv2 as { version?: string } | null)?.version !== doc.version) return err("document_changed", "Originalen ble endret under nedlasting", 409);
    const pdfBytes = new Uint8Array(await blob.arrayBuffer());
    const pdfBase64 = encodeBase64(pdfBytes);
    // Samme tekstlag-helper som produksjonsleseren: endret input måles i profilen.
    const pdfText = await readOriginalPdfText(pdfBytes);
    const textBlock = formatPdfTextForModel(pdfText);

    // Eksisterende kryptert OpenAI-nøkkel (aktiv først). Aldri returnert.
    const { data: cfgs } = await admin.from("ai_provider_config").select("encrypted_api_key, is_active, temperature")
      .eq("provider", "openai").eq("purpose", "invoice_extraction").order("is_active", { ascending: false }).limit(1);
    const cfg = (cfgs ?? [])[0] as { encrypted_api_key: string; temperature: number | null } | undefined;
    if (!cfg) return err("no_credential", "Ingen OpenAI-nøkkel er satt opp", 422);
    const apiKey = await decryptWithKey(cfg.encrypted_api_key, "AI_CONFIG_ENCRYPTION_KEY");

    // Samme kontrollfakta for alle modeller.
    const incl = numOrNull(inv.total_amount);
    const vat = numOrNull(inv.total_vat);
    const supplier = Array.isArray(inv.suppliers) ? inv.suppliers[0] : inv.suppliers;
    let knownItems: { sku: string | null; name: string | null }[] = [];
    let examples: LearningExample[] = [];
    if (inv.supplier_id) {
      const { data: ki } = await admin.from("raw_material_suppliers")
        .select("supplier_sku, supplier_product_name, raw_materials!inner(legal_entity_id)")
        .eq("supplier_id", inv.supplier_id).eq("raw_materials.legal_entity_id", le).not("supplier_sku", "is", null).limit(80);
      knownItems = ((ki ?? []) as { supplier_sku: string | null; supplier_product_name: string | null }[]).map((k) => ({ sku: k.supplier_sku, name: k.supplier_product_name }));
      const { data: ex } = await admin.rpc("rm_extraction_examples_for", { p_legal_entity_id: le, p_supplier_id: inv.supplier_id, p_limit: 10 });
      examples = (Array.isArray(ex) ? ex : []).map((e: { original: unknown; corrected: unknown; note?: string | null }) => ({ original: e.original, corrected: e.corrected, note: e.note ?? null }));
    }
    const hints: Hints = {
      is_credit: inv.is_credit_note === true,
      expected_total_excl_vat: incl != null && vat != null ? Math.round((incl - vat) * 100) / 100 : null,
      expected_total_incl_vat: incl, expected_vat: vat,
      supplier_name: (supplier as { name?: string } | null)?.name ?? null,
      invoice_number: inv.invoice_number ?? null,
      known_items: knownItems,
    };

    // Grenser: reserveres ATOMISK (rådgivende lås per selskap i databasen) FØR AI-kallet. To samtidige
    // klikk kan ikke begge slippe gjennom; en reservasjon teller selv om kallet senere feiler.
    const { data: resv, error: resvErr } = await admin.rpc("rm_model_eval_reserve", {
      p_legal_entity_id: le, p_invoice_id: inv.id, p_model: model,
      p_max_per_day: EVAL_LIMITS.maxPerDay, p_dedup_seconds: Math.round(EVAL_LIMITS.dedupWindowMs / 1000),
    });
    const rv = resv as { ok?: boolean; error?: string; reservation_id?: string } | null;
    if (resvErr || !rv) return err("limits_unknown", "Kunne ikke kontrollere grensene; prøv igjen", 503);
    if (rv.error === "daily_limit") return err("daily_limit", `Døgntaket på ${EVAL_LIMITS.maxPerDay} sammenligninger er nådd`, 429);
    if (rv.error === "duplicate") return err("duplicate", "Samme faktura og modell ble nettopp kjørt. Vent to minutter.", 409);
    if (rv.ok !== true || !rv.reservation_id) return err("limits_unknown", "Kunne ikke kontrollere grensene; prøv igjen", 503);
    const reservationId = rv.reservation_id;

    const started = Date.now();
    let errUsage: AiUsage | null = null;
    let last: AiCallResult | null = null;
    let failure: { kind: string; message: string } | null = null;
    const run = await runExtractionAttempts({
      hints, examples, maxAttempts: 1, parseJson: extractJson,
      call: async (userText) => {
        try {
          last = await callAi({
            provider: "openai", apiKey, model, maxTokens: EVAL_LIMITS.maxOutputTokens,
            temperature: Number(cfg.temperature ?? 0.1),
            systemPrompt: INVOICE_EXTRACTION_SYSTEM_PROMPT, userText: textBlock ? `${userText}\n\n${textBlock}` : userText, pdfBase64,
            jsonSchema: { name: "invoice_extraction", schema: INVOICE_EXTRACTION_SCHEMA },
            timeoutMs: EVAL_LIMITS.timeoutMs,
          });
          return last;
        } catch (e) {
          errUsage = usageOf(e);
          failure = e instanceof AiCallError ? { kind: e.kind, message: e.message.slice(0, 300) } : { kind: "error", message: e instanceof Error ? e.message.slice(0, 300) : "ukjent" };
          throw e;
        }
      },
    });
    const latencyMs = Date.now() - started;
    // Ved avslag/ufullstendig svar brukes forbruket fra feilen — betalte tokens skal ikke forsvinne.
    const r = (last as AiCallResult | null) ?? (errUsage as AiUsage | null);
    const usage = {
      input_tokens: r?.inputTokens ?? null, output_tokens: r?.outputTokens ?? null,
      cached_input_tokens: r?.cachedInputTokens ?? null, reasoning_tokens: r?.reasoningTokens ?? null,
    };
    const cost = estimateCostUsd(model, usage.input_tokens, usage.output_tokens, usage.cached_input_tokens);
    const f = failure as { kind: string; message: string } | null;
    const parseFailed = !f && !run.best;

    // Reservasjonsraden fullføres (ingen ny rad).
    await admin.from("ai_usage_log").update({
      input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, estimated_cost_usd: cost,
      success: !f && !parseFailed, error_message: f ? `${f.kind}: ${f.message}` : parseFailed ? "invalid_json" : null,
    }).eq("id", reservationId);

    const lines = run.best?.lines ?? [];
    const checks = run.best ? deterministicChecks(lines, { excl: hints.expected_total_excl_vat, incl, vat }) : null;
    const { count: storedLines } = await userClient.from("invoice_lines").select("id", { count: "exact", head: true }).eq("invoice_id", inv.id);
    const header = run.best ? Object.fromEntries(Object.entries(run.best).filter(([k]) => k !== "lines")) : null;

    return json({
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      model,
      available: f?.kind !== "model_unavailable",
      status: f ? f.kind : parseFailed ? "invalid_json" : "ok",
      error: f?.message ?? (parseFailed ? "Svaret var ikke gyldig JSON" : null),
      usage,
      estimated_cost_usd: cost,
      cost_known: cost != null,
      cost_rate_version: COST_RATE_VERSION,
      cost_cached_rate: cost == null ? null : hasCachedRate(model) ? "egen_sats" : "full_inndatapris_konservativt",
      // Evalen bruker produksjonsprompten MED strict schema. Produksjonsleseren bruker schema bare når det er slått på.
      request_profile: { prompt: "produksjon", schema: INVOICE_EXTRACTION_SCHEMA_VERSION, single_attempt: true, read: pdfTextProfile(pdfText) },
      latency_ms: latencyMs,
      document_version: doc.version,
      parsed: run.best ? { header, lines } : null,
      checks: checks?.checks ?? [],
      check_counts: checks?.counts ?? {},
      stored_line_count: storedLines ?? null,
      // Fasit brukes bare her, etter modellsvaret — aldri som hint.
      fasit: run.best ? scoreAgainstFasit(inv.id, { lines, header }) : null,
      quality: run.best && scoreAgainstFasit(inv.id, { lines, header }) ? "fasit" : "ikke_verifisert",
      warnings: run.warnings,
    });
  } catch (e) {
    console.error("invoice-model-eval", e instanceof Error ? e.message : "ukjent");
    return err("internal", "Ukjent feil i modellsammenligningen", 500);
  }
});
