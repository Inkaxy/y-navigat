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
//
// Rettepakke 13.11.2026:
//  - Svaret har ai_status («ok» | «no_lines» | «failed» | «not_configured») og ai_failure (type + norsk tekst).
//    En AI-feil (nøkkel, kvote, nede, nettverk, tid) blir aldri «ingen lesbare linjer».
//  - Reserveleverandør (ai_provider_config.use_as_fallback, PENDING-SQL) brukes bare ved tjenestefeil.
//  - { probe: true } (bare tjenesten): gratis tilgangssjekk av nøkkel/modell, ingen tokens.
//  - Lange fakturaer leses i sidebolker når svaret kuttes eller senere sider mangler (aiRead.ts).
//  - Tallkontroll uten AI retter bare entydige tusenskille/desimalfeil (_shared/numberCheck.ts).

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  checkSum, computeConfidence, num, type Hints, type LearningExample,
} from "../_shared/invoiceExtraction.ts";
import { classifyAiFailure, type AiFailure } from "../_shared/aiFailure.ts";
import { probeConfig, readWithConfig, type AiConfigRow, type ReadContext } from "./aiRead.ts";
import { decodeBase64 } from "jsr:@std/encoding@1/base64";
import { formatPdfTextForModel, PDF_TEXT_LIMITS, pdfTextProfile, type PdfTextResult } from "../_shared/pdfText.ts";
import { readOriginalPdfText } from "../_shared/pdfTextRuntime.ts";
import { annotateSkuTextCheck } from "../_shared/invoiceExtraction.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    // Bruksloggen kobles til fakturaen bare når id-en faktisk finnes i samme selskap.
    // Uten id (f.eks. manuell PDF-import før lagring) logges kallet som ukoblet (invoice_id=null).
    let usageInvoiceId: string | null = null;
    if (typeof body.invoice_id === "string" && /^[0-9a-f-]{36}$/i.test(body.invoice_id)) {
      const { data: invRow } = await admin.from("invoices").select("id").eq("id", body.invoice_id).eq("legal_entity_id", legal_entity_id).maybeSingle();
      usageInvoiceId = invRow?.id ?? null;
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

    // Hovedleverandør (aktiv) og ev. reserve. Kolonnen use_as_fallback finnes først etter PENDING-SQL
    // 20261113_ai_fallback_provider; uten den gir spørringen feil og ingen reserve brukes (som før).
    const CFG_COLS = "id, provider, model, encrypted_api_key, max_tokens, temperature, azure_endpoint, azure_deployment";
    const { data: cfgRow } = await admin.from("ai_provider_config").select(CFG_COLS)
      .eq("purpose", "invoice_extraction").eq("is_active", true).maybeSingle();
    const cfg = (cfgRow ?? null) as AiConfigRow | null;
    const loadFallback = async (): Promise<AiConfigRow | null> => {
      const { data, error } = await admin.from("ai_provider_config").select(CFG_COLS)
        .eq("purpose", "invoice_extraction").eq("is_active", false).eq("use_as_fallback", true).limit(1).maybeSingle();
      if (error) return null;
      return (data ?? null) as AiConfigRow | null;
    };

    // Tilgangssjekk uten tokens (brukes av importen før køen tas, når forrige kall feilet på tjenesten).
    if (body.probe === true) {
      if (!isServiceCall) return jsonErr("Kun tjenesten", 403);
      const primary = cfg ? await probeConfig(cfg) : classifyAiFailure("ingen aktiv ai", null);
      const fb = primary !== "ok" && primary !== null ? await loadFallback() : null;
      const fbRes = fb ? await probeConfig(fb) : null;
      const ok = primary === "ok" || primary === null || fbRes === "ok";
      return new Response(JSON.stringify({
        ai_status: ok ? "ok" : "failed",
        ai_failure: ok ? null : primary,
        ai_provider_used: primary === "ok" || primary === null ? "primary" : fbRes === "ok" ? "fallback" : null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let extractionMethod: "ai" | "regex" | "hybrid" = "regex";
    let aiData: any = null;
    let aiUsage: { in: number | null; out: number | null; cost: number | null } = { in: null, out: null, cost: null };
    const warnings: string[] = [];
    let attempts = 0;
    // ai_status skiller «AI-kallet feilet» fra «AI svarte, men fant ingen linjer».
    let aiStatus: "ok" | "no_lines" | "failed" | "not_configured" | "not_attempted" = "not_attempted";
    let aiFailure: AiFailure | null = null;
    let providerUsed: "primary" | "fallback" | null = null;
    let chunked: { chunks: number; reason: string } | null = null;

    // Tekstlaget i original-PDF-en som ekstra lesestøtte (samme helper som linjeforslag og eval). Ikke logget.
    let pdfText: PdfTextResult | null = null;
    let pdfBytes: Uint8Array | null = null;
    if (pdf_base64) {
      try {
        pdfBytes = decodeBase64(pdf_base64);
        pdfText = pdfBytes.byteLength <= PDF_TEXT_LIMITS.maxBytes ? await readOriginalPdfText(pdfBytes) : null;
      } catch { pdfText = null; }
      if (pdfText && pdfText.status !== "ok") warnings.push("PDF-en har ikke brukbart tekstlag – lest bare visuelt");
    }
    const textBlock = pdfText ? formatPdfTextForModel(pdfText) : null;

    if (pdf_base64) {
      const ctx: ReadContext = { admin, legalEntityId: legal_entity_id, usageInvoiceId, hints, examples, maxAttempts, pdfBase64: pdf_base64, pdfBytes, pdfText, textBlock };
      let out = cfg ? await readWithConfig(ctx, cfg) : null;
      if (cfg) providerUsed = "primary";
      // Reserve bare når hovedleverandøren feiler på tjenesten (nøkkel/kvote/nede/nettverk/oppsett) eller mangler.
      if (!out || (out.failure?.systemic && !out.best)) {
        const fb = await loadFallback();
        if (fb) {
          const primaryFailure = out?.failure ?? null;
          if (out) warnings.push(...out.warnings);
          warnings.push(`Hovedleverandøren feilet (${primaryFailure?.message ?? "ingen aktiv AI-tjeneste"}); leser med reserveleverandøren`);
          out = await readWithConfig(ctx, fb);
          providerUsed = "fallback";
          if (!out.best && primaryFailure) out = { ...out, failure: out.failure ?? primaryFailure };
        }
      }
      if (out) {
        attempts = out.attempts;
        warnings.push(...out.warnings);
        aiUsage = out.usage;
        chunked = out.chunked;
        if (out.best) {
          aiData = out.best;
          extractionMethod = "ai";
          aiStatus = Array.isArray(out.best.lines) && out.best.lines.length > 0 ? "ok" : "no_lines";
        } else if (out.failure) {
          aiStatus = "failed";
          aiFailure = out.failure;
          warnings.push(out.failure.message);
        } else {
          aiStatus = "no_lines";
        }
      } else {
        aiStatus = "not_configured";
        aiFailure = classifyAiFailure("ingen aktiv ai", null);
        warnings.push("Ingen aktiv AI-konfigurasjon — bruker regex");
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

    if (Array.isArray(extracted.lines) && pdfText?.status === "ok") extracted.lines = annotateSkuTextCheck(extracted.lines, pdfText.pages);
    const lines = (extracted.lines ?? []) as any[];
    const expected = hints.expected_total_excl_vat;
    const sum = checkSum(lines, expected, hints.expected_total_incl_vat, hints.expected_vat, hints.is_credit);
    // Tallkontrollens retting (tusenskille/desimaltegn) er et fakturavarsel: fakturaen skal gjennomgås.
    const numberIssue = aiData && aiData.number_check_issue && typeof aiData.number_check_issue === "object" ? aiData.number_check_issue : null;
    if (numberIssue) { sum.issues.push(numberIssue); warnings.push(numberIssue.message); }
    if (aiStatus === "no_lines" && (hints.expected_total_incl_vat ?? 0) !== 0) {
      sum.issues.push({ code: "tomt_resultat", message: "AI-lesingen fant ingen linjer, men fakturaen har et beløp. Kontroller originalen og registrer linjene." });
    }
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
      ai_status: aiStatus,
      ai_failure: aiFailure,
      ai_provider_used: providerUsed,
      chunked,
      extraction_method: extractionMethod,
      confidence,
      warnings,
      extracted,
      matched_supplier: matchedSupplier,
      name_matched_supplier: nameMatchedSupplier,
      ai_usage: aiUsage,
      read_profile: pdfTextProfile(pdfText),
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

