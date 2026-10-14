// AI-forslag til vare og pakning for ÉN fakturalinje.
//
// Funksjonen foreslår og forklarer — den endrer ingenting. Den kan ikke koble,
// bekrefte, godkjenne, opprette råvare eller lagre startpris; alt det skjer gjennom
// eksisterende bekreftelsesflyt etter at et menneske har bekreftet.
//
// Kandidatene hentes på serveren, begrenset til selskapet brukeren har tilgang
// til. Modellen kan peke på en kandidat ELLER foreslå et utkast til ny råvare
// (også når det ikke finnes kandidater). Svaret valideres strengt i
// ../_shared/lineSuggestion.ts: aldri en id utenfor kandidatlisten, aldri tall
// som ikke står på linjen, ukjent er null.

import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptWithKey } from "../_shared/crypto.ts";
import { AiCallError, callAi, extractJson, estimateCostUsd, usageOf, type AiProvider } from "../_shared/ai-providers.ts";
import {
  buildSuggestUserText, LINE_SUGGESTION_SCHEMA, LINE_SUGGESTION_SYSTEM_PROMPT, NON_GOODS_LINE_KINDS, validateLineSuggestion,
  type KnownPackageVariant, type KnownSupplierItem, type SuggestCandidate, type SuggestContext,
} from "../_shared/lineSuggestion.ts";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { fetchVerifiedOriginal, supabaseOriginalDeps } from "../_shared/invoiceOriginal.ts";
import { alignLineRow, PDF_TEXT_LIMITS } from "../_shared/pdfText.ts";
import { readOriginalPdfText } from "../_shared/pdfTextRuntime.ts";
import { applyOriginalGate, type OriginalUnavailable } from "../_shared/lineSuggestionSource.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const jsonErr = (msg: string, status: number) => json({ error: msg }, status);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

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
    const { invoice_line_id, candidate_ids } = body as { invoice_line_id?: unknown; candidate_ids?: unknown };
    if (typeof invoice_line_id !== "string" || !UUID.test(invoice_line_id)) return jsonErr("invoice_line_id påkrevd", 400);

    // Linjen leses med brukerens egne rettigheter — RLS avgjør hva som er synlig.
    const { data: line, error: lineErr } = await userClient
      .from("invoice_lines")
      .select("id, description, supplier_sku, quantity, unit, unit_price, total_amount, package_size, package_unit, count_per_package, unit_price_basis, line_kind, excluded_at, invoice_id")
      .eq("id", invoice_line_id)
      .maybeSingle();
    if (lineErr) return jsonErr("Kunne ikke lese fakturalinjen", 400);
    if (!line) return jsonErr("Fakturalinjen finnes ikke", 404);

    const { data: invoice, error: invErr } = await userClient
      .from("invoices")
      .select("id, legal_entity_id, supplier_id, currency, is_credit_note, status, excluded_at")
      .eq("id", line.invoice_id)
      .maybeSingle();
    if (invErr) return jsonErr("Kunne ikke lese fakturaen", 400);
    if (!invoice?.legal_entity_id) return jsonErr("Fakturaen finnes ikke", 404);

    const legalEntityId = invoice.legal_entity_id as string;
    const { data: hasAccess } = await userClient.rpc("has_ravarer_invoice_access", {
      _legal_entity_id: legalEntityId,
      _required_level: "write",
    });
    if (hasAccess !== true) return jsonErr("Mangler skrivetilgang til fakturaer", 403);

    // Autoritativ status før AI: utelatt dokument/linje og registrert ikke-vare får aldri vareforslag (og koster ingenting).
    if (line.excluded_at || invoice.excluded_at || invoice.status === "excluded") return json({ suggestion: null, reason: "holdt_utenfor" });
    if (NON_GOODS_LINE_KINDS.has(String(line.line_kind ?? "").toLowerCase())) return json({ suggestion: null, reason: "ikke_vare" });

    // --- Kontekst, alltid avgrenset til selskapet (og leverandøren) ---
    const rmCols = "id, name, sku, base_unit, category, item_type";
    const byId = new Map<string, SuggestCandidate>();
    const add = (rows: unknown) => {
      for (const r of (Array.isArray(rows) ? rows : []) as SuggestCandidate[]) if (r?.id && byId.size < 40) byId.set(String(r.id), r);
    };
    const clientIds = Array.isArray(candidate_ids) ? candidate_ids.filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, 20) : [];
    if (clientIds.length) {
      // Klientens liste er et filter, aldri en utvidelse.
      const { data } = await admin.from("raw_materials").select(rmCols).eq("legal_entity_id", legalEntityId).in("id", clientIds);
      add(data);
    }

    let known: KnownSupplierItem[] = [];
    let packages: KnownPackageVariant[] = [];
    if (invoice.supplier_id) {
      type Row = { id: string; raw_material_id: string; supplier_sku: string | null; supplier_product_name: string | null; package_size: number | null; package_unit: string | null; base_units_per_package: number | null; package_confirmed_at: string | null; raw_materials: SuggestCandidate | SuggestCandidate[] | null };
      const sel = "id, raw_material_id, supplier_sku, supplier_product_name, package_size, package_unit, base_units_per_package, package_confirmed_at, raw_materials!inner(id, name, sku, base_unit, category, item_type, legal_entity_id)";
      const lineSku = String(line.supplier_sku ?? "").trim();
      // 1) Eksakt varenummer FØR den generelle grensen — en kjent vare skal aldri falle utenfor de 40 første.
      let exact: Row[] = [];
      if (lineSku) {
        const { data } = await admin.from("raw_material_suppliers").select(sel)
          .eq("supplier_id", invoice.supplier_id).eq("raw_materials.legal_entity_id", legalEntityId)
          .ilike("supplier_sku", lineSku.replace(/[%_\\]/g, (m) => `\\${m}`)).limit(20);
        exact = (Array.isArray(data) ? data : []) as Row[];
      }
      const { data: rms } = await admin.from("raw_material_suppliers").select(sel)
        .eq("supplier_id", invoice.supplier_id).eq("raw_materials.legal_entity_id", legalEntityId).limit(40);
      const seen = new Set<string>();
      const rows = [...exact, ...((Array.isArray(rms) ? rms : []) as Row[])].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
      const rmOf = (r: Row) => (Array.isArray(r.raw_materials) ? r.raw_materials[0] : r.raw_materials);
      known = rows.map((r) => ({
        raw_material_id: r.raw_material_id, name: rmOf(r)?.name ?? null, supplier_sku: r.supplier_sku,
        supplier_product_name: r.supplier_product_name, package_size: numOrNull(r.package_size), package_unit: r.package_unit,
        base_units_per_package: numOrNull(r.base_units_per_package), confirmed: !!r.package_confirmed_at,
      }));
      // Samme leverandørvarenummer først — det er den sterkeste kjente koblingen.
      const sku = lineSku.replace(/\s+/g, "").toLowerCase();
      const sameSku = rows.filter((r) => sku && (r.supplier_sku ?? "").replace(/\s+/g, "").toLowerCase() === sku);
      add(sameSku.map(rmOf));
      // Bekreftede pakningsvarianter (raw_material_supplier_packages) for samme varenummer.
      if (sameSku.length) {
        const { data: pk } = await admin.from("raw_material_supplier_packages")
          .select("raw_material_supplier_id, supplier_sku_norm, package_size, package_unit, confirmed_at")
          .in("raw_material_supplier_id", sameSku.map((r) => r.id)).is("superseded_at", null).limit(40);
        const rmBy = new Map(sameSku.map((r) => [r.id, r.raw_material_id]));
        packages = ((pk ?? []) as { raw_material_supplier_id: string; supplier_sku_norm: string | null; package_size: number | null; package_unit: string | null; confirmed_at: string | null }[])
          .map((p) => ({ raw_material_id: rmBy.get(p.raw_material_supplier_id) ?? "", supplier_sku_norm: p.supplier_sku_norm ?? lineSku, package_size: numOrNull(p.package_size), package_unit: p.package_unit, confirmed: !!p.confirmed_at }));
      }
    }

    const words = String(line.description ?? "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !/^\d+$/.test(w)).slice(0, 3);
    if (words.length) {
      const { data } = await admin.from("raw_materials").select(rmCols).eq("legal_entity_id", legalEntityId)
        .or(words.map((w) => `name.ilike.%${w.replace(/[%,()]/g, "")}%`).join(",")).limit(30);
      add(data);
    }
    if (!words.length && !line.supplier_sku && byId.size === 0) {
      return json({ suggestion: null, reason: "for_lite_tekst" });
    }

    const { data: catRows } = await admin.from("raw_materials").select("category").eq("legal_entity_id", legalEntityId).not("category", "is", null).limit(1000);
    const categories = [...new Set(((catRows ?? []) as { category: string | null }[]).map((r) => r.category).filter((c): c is string => !!c))].slice(0, 80);

    let corrections: unknown[] = [];
    if (invoice.supplier_id) {
      const { data: ex } = await admin.rpc("rm_extraction_examples_for", { p_legal_entity_id: legalEntityId, p_supplier_id: invoice.supplier_id, p_limit: 5 });
      corrections = Array.isArray(ex) ? ex : [];
    }

    // AI-konfig: samme oppsett som resten av fakturaflyten.
    let { data: cfg } = await admin.from("ai_provider_config").select("*").eq("purpose", "raw_material_suggestions").eq("is_active", true).maybeSingle();
    if (!cfg) {
      const { data: fb } = await admin.from("ai_provider_config").select("*").eq("purpose", "invoice_extraction").eq("is_active", true).maybeSingle();
      cfg = fb ?? null;
    }
    if (!cfg) return json({ suggestion: null, reason: "ingen_ai_konfigurasjon" });

    const ctx: SuggestContext = {
      line: {
        description: line.description, supplier_sku: line.supplier_sku, quantity: numOrNull(line.quantity), unit: line.unit,
        unit_price: numOrNull(line.unit_price), total_amount: numOrNull(line.total_amount), package_size: numOrNull(line.package_size),
        package_unit: line.package_unit, count_per_package: numOrNull(line.count_per_package), unit_price_basis: line.unit_price_basis, line_kind: line.line_kind,
      },
      isCreditNote: invoice.is_credit_note === true,
      currency: invoice.currency ?? null,
      candidates: [...byId.values()].map((c) => ({ id: String(c.id), name: c.name, sku: c.sku, base_unit: c.base_unit, category: c.category, item_type: c.item_type })),
      known,
      packages,
      categories,
      corrections,
    };

    // --- Originalgrunnlag: samme bundne sti+versjon som visningen, før og etter nedlasting ---
    const orig = await fetchVerifiedOriginal(supabaseOriginalDeps(userClient, admin, invoice.id, PDF_TEXT_LIMITS.maxBytes));
    let mode: "tekst" | "pdf" | "ingen" = "ingen";
    let textRow: { page: number; row: string } | null = null;
    let pdfBase64: string | undefined;
    let originalText = "Original: IKKE tilgjengelig. Forslaget bygger bare på den registrerte linjen. original_row_found=null.";
    if (orig.status === "ok" && orig.bytes) {
      const pt = await readOriginalPdfText(orig.bytes);
      const hit = alignLineRow(pt, line.supplier_sku, line.description);
      pdfBase64 = encodeBase64(orig.bytes);
      const identity = `Målrad (frossen identitet): varenummer ${JSON.stringify(line.supplier_sku ?? null)}, beskrivelse ${JSON.stringify(line.description ?? null)}.`;
      if (hit.page != null) {
        mode = "tekst";
        textRow = { page: hit.page, row: hit.row };
        originalText = `Original-PDF er vedlagt. ${identity}\nEntydig rad i tekstlaget (DATA, side ${hit.page}): ${JSON.stringify(hit.row)}`;
      } else {
        mode = "pdf";
        originalText = `Original-PDF er vedlagt (tekstlaget ${pt.status === "ok" ? (hit.by === "flere" ? "har flere mulige rader" : "fant ikke raden") : "er ikke brukbart"}). ${identity} Finn raden selv; er den ikke entydig: original_row_found=false.`;
      }
    }
    const unavailable: OriginalUnavailable | null = orig.status === "ok" ? null : orig.status;

    const apiKey = await decryptWithKey(cfg.encrypted_api_key, "AI_CONFIG_ENCRYPTION_KEY");
    let parsed: unknown = null;
    let usage = { in: null as number | null, out: null as number | null };
    let errorMessage: string | null = null;
    let reason: string | null = null;
    try {
      const result = await callAi({
        provider: cfg.provider as AiProvider,
        apiKey,
        model: cfg.model,
        maxTokens: Math.max(cfg.max_tokens ?? 1200, 1500),
        temperature: Number(cfg.temperature ?? 0.1),
        systemPrompt: LINE_SUGGESTION_SYSTEM_PROMPT,
        userText: `${buildSuggestUserText(ctx)}\n\n${originalText}`,
        pdfBase64,
        jsonSchema: cfg.provider === "anthropic" ? undefined : { name: "invoice_line_suggestion", schema: LINE_SUGGESTION_SCHEMA },
        timeoutMs: pdfBase64 ? 90_000 : 45_000,
        azureEndpoint: cfg.azure_endpoint ?? undefined,
        azureDeployment: cfg.azure_deployment ?? undefined,
      });
      usage = { in: result.inputTokens, out: result.outputTokens };
      parsed = extractJson(result.rawText);
    } catch (e) {
      // Avslag/ufullstendig svar har likevel kostet tokens — behold forbruket i loggen.
      const u = usageOf(e);
      if (u) usage = { in: u.inputTokens, out: u.outputTokens };
      errorMessage = e instanceof Error ? e.message : String(e);
      reason = e instanceof AiCallError
        ? (e.kind === "timeout" ? "tidsavbrudd" : e.kind === "refusal" ? "ai_avslo" : e.kind === "incomplete" ? "ai_ufullstendig" : e.kind === "model_unavailable" ? "modell_utilgjengelig" : "ai_feilet")
        : "ai_feilet";
    }

    await admin.from("ai_usage_log").insert({
      provider: cfg.provider, model: cfg.model, purpose: "invoice_line_match_suggestion",
      input_tokens: usage.in, output_tokens: usage.out, estimated_cost_usd: estimateCostUsd(cfg.model, usage.in, usage.out),
      invoice_id: invoice.id, legal_entity_id: legalEntityId, success: reason == null, error_message: errorMessage?.slice(0, 500) ?? null,
    });

    // AI-feil skal aldri stoppe arbeidet — brukeren fortsetter manuelt.
    if (reason) return json({ suggestion: null, reason, source_status: mode === "ingen" ? "registrert_linje" : mode === "tekst" ? "original_tekst" : "original_pdf", document_version: orig.status === "ok" ? orig.version : null });

    const gated = applyOriginalGate(validateLineSuggestion(parsed, ctx), parsed, mode, textRow, orig.status === "ok" ? orig.version : null, unavailable);
    const src = gated.source;
    return json({
      suggestion: {
        ...gated.suggestion, model: String(cfg.model ?? ""), candidate_count: ctx.candidates.length,
        source_status: src.status, document_version: src.documentVersion, original_reason: src.originalReason,
        original_page: src.page, original_row: src.originalRow, original_differences: src.differences,
      },
      reason: null,
    });
  } catch (e) {
    console.error("suggest-invoice-line-match error", e instanceof Error ? e.message : "ukjent");
    return jsonErr("Ukjent feil i AI-forslaget", 500);
  }
});
