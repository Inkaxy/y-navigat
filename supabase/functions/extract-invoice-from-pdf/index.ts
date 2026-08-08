// Extract structured invoice data from a PDF using user-configured AI provider,
// with regex fallback. Logs usage and cost.

import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptWithKey } from "../_shared/crypto.ts";
import { callAi, extractJson, estimateCostUsd, type AiProvider } from "../_shared/ai-providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Du er en assistent som henter ut strukturert data fra norske inngående fakturaer.
Returner kun gyldig JSON, ingen annen tekst.

Felter som skal hentes:
- supplier_name (string): leverandørens fulle navn
- supplier_org_number (string): 9-sifret org.nr uten mellomrom, ingen "NO" eller "MVA"
- invoice_number (string): fakturanummer
- invoice_date (string, ISO 8601 format YYYY-MM-DD)
- due_date (string, ISO 8601 format) eller null
- total_amount (number): totalbeløp inkl. MVA
- total_vat (number): MVA-beløp eller null
- currency (string): valuta-kode, default "NOK"
- kid_number (string) eller null
- account_number (string): kontonummer for innbetaling, normalisert til 11 siffer uten punktum
- lines (array av objekter):
  - description (string)
  - sku (string) eller null
  - quantity (number) eller null — antall enheter slik fakturaen viser dem (f.eks. 2 hvis "2 STK")
  - unit (string) eller null — NORMALISER til kanonisk form: "kg", "g", "l", "ml", "dl", "cl", "stk", "eske", "pakke", "sekk", "flaske", "rull", "spann", "boks", "brett". Aldri rå koder som "STK", "ESK", "POS", "FL", "KRT", "BX", "PK" — oversett dem.
  - unit_price (number) eller null — pris per enhet (samme enhet som unit)
  - total_amount (number) eller null
  - vat_rate (number) eller null
  - package_size (number) eller null — pakke-størrelse hentet fra beskrivelsen (f.eks. 10 for "10l bib", 90 for "36X90G ALI", 0.5 for "500ml flaske"). Hvis "36X90G", sett package_size=90 og count_per_package=36.
  - package_unit (string) eller null — base-enhet for package_size ("g", "kg", "l", "ml", "dl", "cl", "stk")
  - count_per_package (number) eller null — antall sub-enheter per pakke (f.eks. 36 for "36X90G")
- field_confidence (object): for hvert toppnivå-felt over (utenom lines), gi en tallverdi 0-1 som sier hvor sikker du er.

Eksempler på linjer:
  "TINE Helmelk 10l bib" qty=2 STK   -> unit="stk", package_size=10, package_unit="l"
  "ALI ORIGINAL FINMALT 36X90G" qty=1 ESK -> unit="eske", package_size=90, package_unit="g", count_per_package=36
  "VANILJEKREM 2 KG" qty=96 KG       -> unit="kg", package_size=2, package_unit="kg"  (her er fakturaen tvetydig — sett field_confidence lavt)
  "EPLEJUICE 2L" qty=8 STK           -> unit="stk", package_size=2, package_unit="l"

Hvis du er usikker på et felt, returner null. Aldri gjett.
Returner alltid valid JSON, aldri prose.`;

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
  const toNum = (s: string | undefined) => {
    if (!s) return null;
    const cleaned = s.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };

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

    // Get active AI config
    const { data: cfg } = await admin
      .from("ai_provider_config")
      .select("*")
      .eq("purpose", "invoice_extraction")
      .eq("is_active", true)
      .maybeSingle();

    let extractionMethod: "ai" | "regex" | "hybrid" = "regex";
    let aiData: any = null;
    let aiUsage: { in: number | null; out: number | null; cost: number | null } = { in: null, out: null, cost: null };
    let warnings: string[] = [];

    if (cfg && pdf_base64) {
      try {
        const apiKey = await decryptWithKey(cfg.encrypted_api_key, "AI_CONFIG_ENCRYPTION_KEY");
        const result = await callAi({
          provider: cfg.provider as AiProvider,
          apiKey,
          model: cfg.model,
          maxTokens: cfg.max_tokens,
          temperature: Number(cfg.temperature),
          systemPrompt: SYSTEM_PROMPT,
          userText: "Hent ut data fra denne fakturaen som JSON.",
          pdfBase64: pdf_base64,
          azureEndpoint: cfg.azure_endpoint ?? undefined,
          azureDeployment: cfg.azure_deployment ?? undefined,
        });
        try {
          aiData = extractJson(result.rawText);
          extractionMethod = "ai";
        } catch (e) {
          warnings.push(`AI returnerte ikke gyldig JSON: ${(e as Error).message}`);
        }
        aiUsage = {
          in: result.inputTokens,
          out: result.outputTokens,
          cost: estimateCostUsd(cfg.model, result.inputTokens, result.outputTokens),
        };
        await admin.from("ai_usage_log").insert({
          provider: cfg.provider, model: cfg.model, purpose: "invoice_extraction",
          input_tokens: aiUsage.in, output_tokens: aiUsage.out,
          estimated_cost_usd: aiUsage.cost, legal_entity_id, success: !!aiData,
          error_message: aiData ? null : warnings[warnings.length - 1] ?? null,
        });
      } catch (e) {
        warnings.push(`AI-kall feilet: ${(e as Error).message}`);
        await admin.from("ai_usage_log").insert({
          provider: cfg.provider, model: cfg.model, purpose: "invoice_extraction",
          legal_entity_id, success: false, error_message: (e as Error).message,
        });
      }
    } else if (!cfg) {
      warnings.push("Ingen aktiv AI-konfigurasjon — bruker regex");
    }

    // Regex fallback / hybrid
    let extracted: any;
    if (aiData) {
      extracted = aiData;
      // If AI mangler org.nr og vi har tekst — fyll inn
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

    // Compute overall confidence (avg of field_confidence) — fallback 0.3 for regex, 0.6 for AI
    const fc = extracted.field_confidence ?? {};
    const fcVals = Object.values(fc).filter((v): v is number => typeof v === "number");
    let confidence: number;
    if (fcVals.length > 0) {
      confidence = fcVals.reduce((a, b) => a + b, 0) / fcVals.length;
    } else {
      confidence = extractionMethod === "ai" ? 0.7 : extractionMethod === "hybrid" ? 0.6 : 0.35;
    }

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
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("extract-invoice-from-pdf error", e);
    return jsonErr((e as Error).message ?? "error", 500);
  }
});
