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
//
// Kvalitetstest (AI-tjenester › Kvalitetstest før gjenlesing):
//  - action "check_configs": gratis nøkkelsjekk for hvert lagret oppsett for fakturalesing.
//  - config_id: les med nøkkel og modell fra DET oppsettet (OpenAI eller Anthropic), ikke den aktive nøkkelen.
//  - mode "sidebolker": les fakturaen i sidebolker slik produksjonen gjør når svaret kuttes.
//  - Testfakturaer (qualityTestSet.ts) får målinger mot kontrollsum og fasit, beregnet etter svaret.

import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { formatPdfTextForModel, pdfTextProfile } from "../_shared/pdfText.ts";
import { readOriginalPdfText } from "../_shared/pdfTextRuntime.ts";
import { decryptWithKey } from "../_shared/crypto.ts";
import { AiCallError, callAi, COST_RATE_VERSION, extractJson, estimateCostUsd, hasCachedRate, usageOf, type AiCallResult, type AiUsage } from "../_shared/ai-providers.ts";
import { runExtractionAttempts, type Hints, type LearningExample } from "../_shared/invoiceExtraction.ts";
import { INVOICE_EXTRACTION_SYSTEM_PROMPT } from "../_shared/invoiceExtractionPrompt.ts";
import { scoreAgainstFasit } from "../_shared/evalFasit.ts";
import { fetchVerifiedOriginal, supabaseOriginalDeps } from "../_shared/invoiceOriginal.ts";
import { deterministicChecks, EVAL_LIMITS, INVOICE_EXTRACTION_SCHEMA, INVOICE_EXTRACTION_SCHEMA_VERSION, EVAL_PIPELINE_VERSION, isEvalModel } from "../_shared/modelEval.ts";
import { expectedExclVat } from "../_shared/lines-sum.ts";
import { chunkHint, chunkReason, maxPageOf, mergeChunkExtractions, planPageChunks, type ChunkResult } from "../_shared/chunkedExtraction.ts";
import { applyNumberCheck } from "../_shared/numberCheck.ts";
import { checkSum, type ParsedExtraction } from "../_shared/invoiceExtraction.ts";
import { scoreQuality } from "../_shared/qualityTest.ts";
import { QUALITY_TEST_VERSION, qualityTestEntry } from "../_shared/qualityTestSet.ts";
import { pageTextBlock, pdfPageCount, splitPdf } from "./readerCopies.ts";
import { checkInvoiceConfigs, loadConfigCredential, loadQualityFasit, type EvalCredential } from "./quality.ts";

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

    const body = await req.json().catch(() => ({})) as { action?: unknown; invoice_id?: unknown; model?: unknown; config_id?: unknown; mode?: unknown };
    // Nøkkelsjekk: ingen tokens, ingen skriving, ingen nøkkel i svaret.
    if (body.action === "check_configs") {
      const configs = await checkInvoiceConfigs(admin);
      return configs ? json({ configs }) : err("config_unknown", "Kunne ikke lese AI-oppsettene", 503);
    }
    if (typeof body.invoice_id !== "string" || !UUID.test(body.invoice_id)) return err("invalid", "invoice_id må være en gyldig id", 400);
    const byConfig = body.config_id !== undefined;
    if (byConfig && (typeof body.config_id !== "string" || !UUID.test(body.config_id))) return err("invalid", "config_id må være en gyldig id", 400);
    if (!byConfig && !isEvalModel(body.model)) return err("invalid_model", "Modellen er ikke tillatt i sammenligningen", 400);
    const mode = body.mode === "sidebolker" ? "sidebolker" : "enkelt";

    // Fakturaen leses med brukerens rettigheter (RLS).
    const { data: inv } = await userClient.from("invoices")
      .select("id, legal_entity_id, supplier_id, invoice_number, total_amount, total_vat, is_credit_note, suppliers(name)")
      .eq("id", body.invoice_id).maybeSingle();
    if (!inv?.legal_entity_id) return err("not_found", "Fakturaen finnes ikke eller er ikke tilgjengelig", 404);
    const le = inv.legal_entity_id as string;
    const { data: canRead } = await userClient.rpc("has_ravarer_invoice_access", { _legal_entity_id: le, _required_level: "read" });
    if (canRead !== true) return err("forbidden", "Mangler tilgang til fakturaen", 403);

    // Original: samme versjonsbundne helper som produksjon (tilgang + selskapssti, kontroll før/etter, frist per steg).
    const orig = await fetchVerifiedOriginal(supabaseOriginalDeps(userClient, admin, inv.id, EVAL_LIMITS.maxPdfBytes));
    if (orig.status === "mangler") return err("document_missing", "Fakturaen har ingen lagret original-PDF", 422);
    if (orig.status === "for_stor") return err("document_too_large", "Originalen er for stor for sammenligning", 413);
    if (orig.status === "endret") return err("document_changed", "Originalen ble endret under nedlasting", 409);
    if (orig.status !== "ok" || !orig.bytes || !orig.version) return err("document_unknown", "Kunne ikke kontrollere eller laste ned originalen", 503);
    const doc = { version: orig.version };
    const pdfBytes = orig.bytes;
    const pdfBase64 = encodeBase64(pdfBytes);
    // Samme tekstlag-helper som produksjonsleseren: endret input måles i profilen.
    const pdfText = await readOriginalPdfText(pdfBytes);
    const textBlock = formatPdfTextForModel(pdfText);

    // Nøkkel: fra valgt oppsett (kvalitetstest) eller eksisterende aktiv OpenAI-nøkkel (modellvalg). Aldri returnert.
    let cred: EvalCredential;
    if (byConfig) {
      const c = await loadConfigCredential(admin, body.config_id as string);
      if ("code" in c) return err(c.code, c.message, c.status);
      cred = c;
    } else {
      const { data: cfgs } = await admin.from("ai_provider_config").select("encrypted_api_key, is_active, temperature")
        .eq("provider", "openai").eq("purpose", "invoice_extraction").order("is_active", { ascending: false }).limit(1);
      const cfg = (cfgs ?? [])[0] as { encrypted_api_key: string; temperature: number | null } | undefined;
      if (!cfg) return err("no_credential", "Ingen OpenAI-nøkkel er satt opp", 422);
      cred = { configId: null, provider: "openai", model: body.model as string, apiKey: await decryptWithKey(cfg.encrypted_api_key, "AI_CONFIG_ENCRYPTION_KEY"), temperature: Number(cfg.temperature ?? 0.1) };
    }
    const model = cred.model;

    // Sidebolker planlegges FØR reservasjonen: en faktura som ikke kan deles koster ingenting.
    const totalPages = pdfText.totalPages ?? await pdfPageCount(pdfBytes);
    const chunks = mode === "sidebolker" && totalPages != null ? planPageChunks(totalPages) : [];
    let parts: string[] | null = null;
    if (mode === "sidebolker") {
      if (totalPages == null || totalPages < 2) return err("not_multipage", "Fakturaen har bare én side og kan ikke deles", 422);
      parts = await splitPdf(pdfBytes, chunks);
      if (!parts) return err("split_failed", "PDF-en kunne ikke deles i sider", 422);
    }

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
      expected_total_excl_vat: expectedExclVat(incl, vat, inv.is_credit_note === true),
      expected_total_incl_vat: incl, expected_vat: vat,
      supplier_name: (supplier as { name?: string } | null)?.name ?? null,
      invoice_number: inv.invoice_number ?? null,
      known_items: knownItems,
    };

    // Grenser: reserveres ATOMISK (rådgivende lås per selskap i databasen) FØR AI-kallet. To samtidige
    // klikk kan ikke begge slippe gjennom; en reservasjon teller selv om kallet senere feiler.
    const { data: resv, error: resvErr } = await admin.rpc("rm_model_eval_reserve", {
      p_legal_entity_id: le, p_invoice_id: inv.id, p_model: mode === "sidebolker" ? `${model} sidebolker` : model,
      p_max_per_day: EVAL_LIMITS.maxPerDay, p_dedup_seconds: Math.round(EVAL_LIMITS.dedupWindowMs / 1000),
    });
    const rv = resv as { ok?: boolean; error?: string; reservation_id?: string } | null;
    if (resvErr || !rv) return err("limits_unknown", "Kunne ikke kontrollere grensene; prøv igjen", 503);
    if (rv.error === "daily_limit") return err("daily_limit", `Døgntaket på ${EVAL_LIMITS.maxPerDay} sammenligninger er nådd`, 429);
    if (rv.error === "duplicate") return err("duplicate", "Samme faktura og modell ble nettopp kjørt. Vent to minutter.", 409);
    if (rv.ok !== true || !rv.reservation_id) return err("limits_unknown", "Kunne ikke kontrollere grensene; prøv igjen", 503);
    const reservationId = rv.reservation_id;

    const started = Date.now();
    // Forbruk summeres over alle kall (én ved enkeltlesing, én per bolk). Ved avslag/ufullstendig svar brukes
    // forbruket fra feilen — betalte tokens skal ikke forsvinne.
    const tot = { in: 0, out: 0, cached: 0, reasoning: 0, any: false };
    const addUsage = (u: AiUsage | AiCallResult | null) => {
      if (!u || u.inputTokens == null || u.outputTokens == null) return;
      tot.any = true; tot.in += u.inputTokens; tot.out += u.outputTokens; tot.cached += u.cachedInputTokens ?? 0; tot.reasoning += u.reasoningTokens ?? 0;
    };
    let failure: { kind: string; message: string } | null = null;
    const call = (pdf: string, text: string | null, timeoutMs: number) => async (userText: string) => {
      try {
        const res = await callAi({
          provider: cred.provider, apiKey: cred.apiKey, model, maxTokens: EVAL_LIMITS.maxOutputTokens,
          temperature: cred.temperature,
          systemPrompt: INVOICE_EXTRACTION_SYSTEM_PROMPT, userText: text ? `${userText}\n\n${text}` : userText, pdfBase64: pdf,
          // Anthropic-kallet bruker ikke schema (samme som produksjonsleseren); svaret tolkes som JSON.
          jsonSchema: { name: "invoice_extraction", schema: INVOICE_EXTRACTION_SCHEMA },
          timeoutMs,
        });
        addUsage(res);
        return res;
      } catch (e) {
        addUsage(usageOf(e));
        failure = e instanceof AiCallError ? { kind: e.kind, message: e.message.slice(0, 300) } : { kind: "error", message: e instanceof Error ? e.message.slice(0, 300) : "ukjent" };
        throw e;
      }
    };
    let best: ParsedExtraction | null = null;
    let warnings: string[] = [];
    let chunkSuggested: string | null = null;
    let chunked: { chunks: number; complete: boolean; failed: string[] } | null = null;
    if (mode === "enkelt") {
      const run = await runExtractionAttempts({ hints, examples, maxAttempts: 1, parseJson: extractJson, call: call(pdfBase64, textBlock, EVAL_LIMITS.timeoutMs) });
      best = run.best; warnings = run.warnings;
      // Samme regel som produksjonen: ville denne lesingen blitt delt i sidebolker?
      const sc = best ? checkSum(best.lines, hints.expected_total_excl_vat, null, null, hints.is_credit) : null;
      chunkSuggested = chunkReason({ truncated: run.truncated, totalPages, linesSum: sc?.lines_sum ?? null, expectedExcl: sc?.expected_excl_vat ?? null, maxPageSeen: best ? maxPageOf(best.lines) : null });
    } else {
      // Alle bolker samtidig (høyst 8), ett forsøk hver, ingen tallkontroll per bolk — som produksjonen.
      const chunkHints = { ...hints, expected_total_excl_vat: null };
      const results: ChunkResult[] = await Promise.all(chunks.map(async (c, j) => {
        const r = await runExtractionAttempts({
          hints: chunkHints, examples, maxAttempts: 1, parseJson: extractJson, numberCheck: false, extraHint: chunkHint(c, totalPages!),
          call: call(parts![j], pageTextBlock(pdfText, c.from, c.to), EVAL_LIMITS.chunkTimeoutMs),
        });
        warnings.push(...r.warnings);
        return { chunk: c, data: r.best };
      }));
      const merged = mergeChunkExtractions(results);
      chunked = { chunks: chunks.length, complete: merged.complete, failed: merged.failedChunks.map((c) => `side ${c.from}–${c.to}`) };
      if (merged.complete) {
        const nc = applyNumberCheck(merged.data.lines, hints.expected_total_excl_vat, hints.is_credit);
        best = { ...merged.data, lines: nc.lines, number_check_issue: nc.invoiceIssue };
        failure = null;
      }
    }
    const latencyMs = Date.now() - started;
    const usage = {
      input_tokens: tot.any ? tot.in : null, output_tokens: tot.any ? tot.out : null,
      cached_input_tokens: tot.any ? tot.cached : null, reasoning_tokens: tot.any ? tot.reasoning : null,
    };
    const cost = estimateCostUsd(model, usage.input_tokens, usage.output_tokens, usage.cached_input_tokens);
    const f = best ? null : failure as { kind: string; message: string } | null;
    const parseFailed = !f && !best;

    // Reservasjonsraden fullføres (ingen ny rad). Leverandøren settes fra oppsettet (reservasjonen skriver openai).
    await admin.from("ai_usage_log").update({
      provider: cred.provider, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, estimated_cost_usd: cost,
      success: !f && !parseFailed, error_message: f ? `${f.kind}: ${f.message}` : parseFailed ? "invalid_json" : null,
    }).eq("id", reservationId);

    const lines = best?.lines ?? [];
    const checks = best ? deterministicChecks(lines, { excl: hints.expected_total_excl_vat, incl, vat }) : null;
    const { count: storedLines } = await userClient.from("invoice_lines").select("id", { count: "exact", head: true }).eq("invoice_id", inv.id);
    const header = best ? Object.fromEntries(Object.entries(best).filter(([k]) => k !== "lines")) : null;
    const entry = qualityTestEntry(inv.id);
    const qf = entry && best ? await loadQualityFasit(userClient, entry) : null;

    return json({
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      model,
      config_id: cred.configId,
      provider: cred.provider,
      mode,
      total_pages: totalPages,
      chunk_suggested: chunkSuggested,
      chunked,
      available: f?.kind !== "model_unavailable",
      status: f ? f.kind : parseFailed ? "invalid_json" : "ok",
      error: f?.message ?? (parseFailed ? "Svaret var ikke gyldig JSON" : null),
      usage,
      estimated_cost_usd: cost,
      cost_known: cost != null,
      cost_rate_version: COST_RATE_VERSION,
      cost_cached_rate: cost == null ? null : hasCachedRate(model) ? "egen_sats" : "full_inndatapris_konservativt",
      // Evalen bruker produksjonsprompten MED strict schema. Produksjonsleseren bruker schema bare når det er slått på.
      request_profile: { prompt: "produksjon", pipeline: EVAL_PIPELINE_VERSION, schema: INVOICE_EXTRACTION_SCHEMA_VERSION, schema_sent: cred.provider !== "anthropic", single_attempt: true, mode, read: pdfTextProfile(pdfText) },
      latency_ms: latencyMs,
      document_version: doc.version,
      parsed: best ? { header, lines } : null,
      checks: checks?.checks ?? [],
      check_counts: checks?.counts ?? {},
      stored_line_count: storedLines ?? null,
      // Fasit brukes bare her, etter modellsvaret — aldri som hint.
      fasit: best ? scoreAgainstFasit(inv.id, { lines, header }) : null,
      quality: best && scoreAgainstFasit(inv.id, { lines, header }) ? "fasit" : "ikke_verifisert",
      // Kvalitetstest: målinger beregnet etter svaret; fasit sendes aldri til modellen.
      quality_test: entry ? {
        version: QUALITY_TEST_VERSION, role: entry.role, fasit_status: qf?.status ?? "ingen",
        metrics: best ? scoreQuality({
          role: entry.role, lines, totalAmount: incl, totalVat: vat, isCredit: hints.is_credit, totalPages,
          fasit: qf?.status === "ok" && qf.source ? { rows: qf.rows, source: qf.source } : null,
        }) : null,
      } : null,
      warnings,
    });
  } catch (e) {
    console.error("invoice-model-eval", e instanceof Error ? e.message : "ukjent");
    return err("internal", "Ukjent feil i modellsammenligningen", 500);
  }
});
