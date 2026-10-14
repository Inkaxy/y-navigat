// Leser strukturerte data ut av en faktura-PDF med selskapets AI-oppsett (regex som nødløsning).
//
// Priskontroll v2:
//  - Kalleren kan sende KONTROLLFAKTA fra regnskapssystemet (sum eks./inkl. mva, leverandør,
//    fakturanummer) og KJENTE VARER (varenummer → navn). Modellen bruker dem til å lese
//    riktig, og til å kontrollere seg selv: summen av linjene skal bli lik sum eks. mva.
//  - Linjene får linjetype (vare/pant/frakt/gebyr/rabatt/avrunding) og enhetsprisgrunnlag
//    (per enhet eller per kg/l), slik at motoren slipper å gjette.
//  - Nytt forsøk ved tomt svar, ugyldig JSON eller sumavvik, med konkret avvikshint.
//  - Beløp skaleres ALDRI for å treffe kontrollsummen (ingen automatisk mva-retting). Et forhold
//    på 1/1,25 kan være en manglende linje; vi rapporterer manglende beløp i stedet.
//  - Bekreftede menneskelige rettelser (selskap + leverandør) gis modellen som data, ikke instruks.
//  - Logikken ligger i ../_shared/invoiceExtraction.ts og testes i vitest.
// Logger bruk og kostnad per kall.

import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptWithKey } from "../_shared/crypto.ts";
import { callAi, extractJson, estimateCostUsd, type AiProvider } from "../_shared/ai-providers.ts";
import {
  checkSum, computeConfidence, num, runExtractionAttempts, type Hints, type LearningExample,
} from "../_shared/invoiceExtraction.ts";
import { INVOICE_EXTRACTION_SYSTEM_PROMPT } from "../_shared/invoiceExtractionPrompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = INVOICE_EXTRACTION_SYSTEM_PROMPT;

function jsonErr(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normOrg(s: any): string | null {
  if (!s) return null;
  const d = String(s).replace(/\D/g, "");
  return d.length === 9 ? d : null;
}

function normAccount(s: any): string | null {
  if (!s) return null;
  const d = String(s).replace(/\D/g, "");
  return d.length === 11 ? d : null;
}

function regexExtract(text: string) {
  const orgMatch = text.match(/(?:Org\.?nr\.?|Foretaksnr\.?|Organisasjonsnr\.?)[:\s]*(\d{3}\s?\d{3}\s?\d{3})/i)
    ?? text.match(/\b(\d{3}\s?\d{3}\s?\d{3})\b/);
  const invNoMatch = text.match(/(?:Faktura(?:nr|nummer)\.?|Invoice\s*(?:no|number)\.?)[:\s#]*([A-Z0-9\-]+)/i);
  const dateMatch = text.match(/(?:Fakturadato|Invoice\s*date)[:\s]*(\d{2}[.\/-]\d{2}[.\/-]\d{4})/i)
    ?? text.match(/(\d{2}[.\/-]\d{2}[.\/-]\d{4})/);
  const dueMatch = text.match(/(?:Forfall(?:sdato)?|Due\s*date)[:\s]*(\d{2}[.\/-]\d{2}[.\/-]\d{4})/i);
  const totalMatch = text.match(/(?:Total(?:t)?(?:\s+å\s+betale)?|Sum\s+å\s+betale|Å\s+betale|Beløp\s+å\s+betale)[:\s]*([\d\s.,]+)/i);
  const kidMatch = text.match(/(?:KID|KIDnr)[:\s]*(\d{2,25})/i);
  const accMatch = text.match(/(?:Konto(?:nr)?|Bankkonto)[:\s]*(\d{4}[.\s]?\d{2}[.\s]?\d{5})/i);

  const firstLine = text.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 2 && l.length < 80);

  const toIso = (s: string | undefined) => {
    if (!s) return null;
    const m = s.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };
  const toNum = (s: string | undefined) => (s ? num(s) : null);

  return {
    supplier_name: firstLine ?? null,
    supplier_org_number: normOrg(orgMatch?.[1]),
    invoice_number: invNoMatch?.[1] ?? null,
    invoice_date: toIso(dateMatch?.[1]),
    due_date: toIso(dueMatch?.[1]),
    total_amount: toNum(totalMatch?.[1]),
    total_vat: null,
    currency: "NOK",
    kid_number: kidMatch?.[1] ?? null,
    account_number: normAccount(accMatch?.[1]),
    lines: [],
    field_confidence: {} as Record<string, number>,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization");
    if (!auth) return jsonErr("Missing Authorization", 401);

    // Tjenestekall (cron/import) med service-role-nøkkelen hopper over brukersjekken.
    const isServiceCall = auth.replace(/^Bearer\s+/i, "").trim() === serviceKey;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    if (!isServiceCall) {
      const { data: userRes } = await userClient.auth.getUser();
      const user = userRes?.user;
      if (!user) return jsonErr("Not authenticated", 401);
    }

    const body = await req.json().catch(() => ({}));
    const { legal_entity_id, pdf_base64, pdf_text } = body;
    if (!legal_entity_id) return jsonErr("legal_entity_id påkrevd", 400);
    if (!pdf_base64 && !pdf_text) return jsonErr("pdf_base64 eller pdf_text påkrevd", 400);

    if (!isServiceCall) {
      const { data: hasAccess } = await userClient.rpc("has_ravarer_invoice_access", {
        _legal_entity_id: legal_entity_id, _required_level: "write",
      });
      if (!hasAccess) return jsonErr("Mangler skrivetilgang til fakturaer", 403);
    }

    const supplierId: string | null = typeof body.supplier_id === "string" && /^[0-9a-f-]{36}$/i.test(body.supplier_id) ? body.supplier_id : null;
    const hints: Hints = {
      is_credit: body.is_credit === true,
      expected_total_excl_vat: num(body.expected_total_excl_vat),
      expected_total_incl_vat: num(body.expected_total_incl_vat),
      expected_vat: num(body.expected_vat),
      supplier_name: typeof body.supplier_name === "string" ? body.supplier_name : null,
      invoice_number: typeof body.invoice_number === "string" ? body.invoice_number : null,
      known_items: Array.isArray(body.known_items)
        ? body.known_items.filter((k: any) => k && typeof k === "object").map((k: any) => ({
            sku: k.sku == null ? null : String(k.sku), name: k.name == null ? null : String(k.name),
          }))
        : [],
    };
    const maxAttempts = Math.max(1, Math.min(3, Number(body.max_attempts ?? 2) || 2));

    // Bekreftede menneskelige rettelser, avgrenset til selskap + leverandør (RPC-en sjekker at
    // leverandøren tilhører selskapet). Gis modellen som data.
    let examples: LearningExample[] = [];
    if (supplierId) {
      const { data: ex, error: exErr } = await admin.rpc("rm_extraction_examples_for", {
        p_legal_entity_id: legal_entity_id, p_supplier_id: supplierId, p_limit: 10,
      });
      if (exErr) console.error("rm_extraction_examples_for", exErr.message);
      examples = (Array.isArray(ex) ? ex : []).map((e: any) => ({ original: e.original, corrected: e.corrected, note: e.note ?? null }));
    }

    const { data: cfg } = await admin
      .from("ai_provider_config")
      .select("*")
      .eq("purpose", "invoice_extraction")
      .eq("is_active", true)
      .maybeSingle();

    let extractionMethod: "ai" | "regex" | "hybrid" = "regex";
    let aiData: any = null;
    let aiUsage: { in: number | null; out: number | null; cost: number | null } = { in: null, out: null, cost: null };
    const warnings: string[] = [];
    let attempts = 0;

    if (cfg && pdf_base64) {
      const apiKey = await decryptWithKey(cfg.encrypted_api_key, "AI_CONFIG_ENCRYPTION_KEY");
      const run = await runExtractionAttempts({
        hints, examples, maxAttempts, parseJson: extractJson,
        call: async (userText) => {
          try {
            const result = await callAi({
              provider: cfg.provider as AiProvider,
              apiKey,
              model: cfg.model,
              maxTokens: Math.max(Number(cfg.max_tokens ?? 2000), 12000),
              temperature: Number(cfg.temperature),
              systemPrompt: SYSTEM_PROMPT,
              userText,
              pdfBase64: pdf_base64,
              azureEndpoint: cfg.azure_endpoint ?? undefined,
              azureDeployment: cfg.azure_deployment ?? undefined,
            });
            aiUsage = { in: (aiUsage.in ?? 0) + (result.inputTokens ?? 0), out: (aiUsage.out ?? 0) + (result.outputTokens ?? 0), cost: null };
            aiUsage.cost = estimateCostUsd(cfg.model, aiUsage.in, aiUsage.out);
            return result;
          } catch (e) {
            await admin.from("ai_usage_log").insert({
              provider: cfg.provider, model: cfg.model, purpose: "invoice_extraction",
              legal_entity_id, success: false, error_message: (e as Error).message,
            });
            throw e;
          }
        },
      });
      attempts = run.attempts;
      warnings.push(...run.warnings);
      for (const l of run.log) {
        if (l.reason === "call_failed") continue;
        await admin.from("ai_usage_log").insert({
          provider: cfg.provider, model: cfg.model, purpose: "invoice_extraction",
          input_tokens: l.inputTokens ?? null, output_tokens: l.outputTokens ?? null,
          estimated_cost_usd: estimateCostUsd(cfg.model, l.inputTokens ?? null, l.outputTokens ?? null),
          legal_entity_id, success: l.reason !== "invalid_json", error_message: l.reason === "invalid_json" ? (l.error ?? "invalid_json") : l.reason === "empty" ? "tomt_resultat" : null,
        });
      }
      if (run.best) {
        aiData = run.best;
        extractionMethod = "ai";
      }
    } else if (!cfg) {
      warnings.push("Ingen aktiv AI-konfigurasjon — bruker regex");
    }

    // Regex fallback / hybrid
    let extracted: any;
    if (aiData) {
      extracted = aiData;
      if (!normOrg(aiData.supplier_org_number) && pdf_text) {
        const reg = regexExtract(pdf_text);
        if (reg.supplier_org_number) {
          extracted.supplier_org_number = reg.supplier_org_number;
          extractionMethod = "hybrid";
          warnings.push("Org.nr fylt inn fra tekstmønster");
        }
      }
      extracted.supplier_org_number = normOrg(extracted.supplier_org_number);
      extracted.account_number = normAccount(extracted.account_number);
    } else if (pdf_text) {
      extracted = regexExtract(pdf_text);
      extractionMethod = "regex";
    } else {
      extracted = {
        supplier_name: null, supplier_org_number: null, invoice_number: null,
        invoice_date: null, due_date: null, total_amount: null, total_vat: null,
        currency: "NOK", kid_number: null, account_number: null, lines: [], field_confidence: {},
      };
    }

    const lines = (extracted.lines ?? []) as any[];
    const expected = hints.expected_total_excl_vat;
    const sum = checkSum(lines, expected, hints.expected_total_incl_vat, hints.expected_vat);
    for (const i of sum.issues) warnings.push(i.message);
    const arithmeticIssues = lines.filter((l) => Array.isArray(l.read_issues) && l.read_issues.length > 0).length;
    if (arithmeticIssues > 0) warnings.push(`${arithmeticIssues} linje(r) har regne-, enhets- eller fortegnsavvik og må kontrolleres`);
    const confidence = computeConfidence({
      fieldConfidence: extracted.field_confidence, lines, sumDeviationPct: sum.deviation_pct, method: extractionMethod,
    });

    // Match supplier
    let matchedSupplier: any = null;
    if (extracted.supplier_org_number) {
      const { data } = await admin
        .from("suppliers")
        .select("id, name, org_number")
        .eq("legal_entity_id", legal_entity_id)
        .eq("org_number", extracted.supplier_org_number)
        .maybeSingle();
      if (data) matchedSupplier = data;
    }
    let nameMatchedSupplier: any = null;
    if (!matchedSupplier && extracted.supplier_name) {
      const { data } = await admin
        .from("suppliers")
        .select("id, name, org_number")
        .eq("legal_entity_id", legal_entity_id)
        .ilike("name", extracted.supplier_name.trim())
        .limit(1);
      if (data && data.length > 0) nameMatchedSupplier = data[0];
    }

    return new Response(JSON.stringify({
      extraction_method: extractionMethod,
      confidence,
      warnings,
      extracted,
      matched_supplier: matchedSupplier,
      name_matched_supplier: nameMatchedSupplier,
      ai_usage: aiUsage,
      attempts,
      sum_check: {
        lines_sum: sum.lines_sum,
        expected_excl_vat: expected,
        deviation_pct: sum.deviation_pct,
        missing_amount: sum.missing_amount,
        issues: sum.issues,
        vat_scale_factor_applied: null,
        arithmetic_issue_lines: arithmeticIssues,
        examples_used: examples.length,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("extract-invoice-from-pdf error", e);
    return jsonErr((e as Error).message ?? "error", 500);
  }
});

