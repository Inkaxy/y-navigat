// PDF invoice parser using Lovable AI Vision (with text-extraction fallback in client)
// - Receives base64-encoded PDF
// - Uses Gemini Flash to extract supplier info and invoice header fields
// - Returns suggestion: matched supplier (if org.nr exists) OR proposal to create new

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonErr(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeOrgNumber(s: string | null | undefined): string | null {
  if (!s) return null;
  const digits = String(s).replace(/\D/g, "");
  if (digits.length === 9) return digits;
  return null;
}

const EXTRACTION_TOOL = {
  type: "function",
  function: {
    name: "extract_invoice_header",
    description: "Extract supplier and invoice header data from a Norwegian PDF invoice.",
    parameters: {
      type: "object",
      properties: {
        supplier_name: { type: "string", description: "Selskapsnavn til leverandøren (utsteder av fakturaen)" },
        supplier_org_number: {
          type: "string",
          description: "Norsk organisasjonsnummer (9 siffer) til leverandøren. Tom streng hvis ikke funnet.",
        },
        invoice_number: { type: "string", description: "Fakturanummer" },
        invoice_date: { type: "string", description: "Fakturadato i ISO-format YYYY-MM-DD" },
        due_date: { type: "string", description: "Forfallsdato i ISO-format YYYY-MM-DD, tom streng hvis ikke funnet" },
        total_amount: { type: "number", description: "Totalbeløp inkl. mva (sum å betale)" },
        total_vat: { type: "number", description: "MVA-beløp" },
        currency: { type: "string", description: "Valutakode (NOK, EUR, USD osv.). Default NOK." },
        confidence: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "Hvor sikker du er på utvinningen totalt sett",
        },
      },
      required: ["supplier_name", "invoice_number", "invoice_date", "total_amount", "confidence"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonErr("Missing Authorization", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");

    const supabaseAuthed = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    const { data: userRes } = await supabaseAuthed.auth.getUser();
    const user = userRes?.user;
    if (!user) return jsonErr("Not authenticated", 401);

    const body = await req.json().catch(() => ({}));
    const legalEntityId: string | undefined = body?.legal_entity_id;
    const pdfBase64: string | undefined = body?.pdf_base64;
    const fallbackText: string | undefined = body?.pdf_text; // optional client-side text extraction

    if (!legalEntityId) return jsonErr("Missing legal_entity_id", 400);
    if (!pdfBase64 && !fallbackText) return jsonErr("Missing pdf_base64 or pdf_text", 400);

    // Verify access
    const { data: hasAccess, error: accessErr } = await supabaseAuthed.rpc(
      "has_ravarer_invoice_access",
      { _user_id: user.id, _legal_entity_id: legalEntityId, _required: "write" },
    );
    if (accessErr) throw accessErr;
    if (!hasAccess) return jsonErr("Mangler skrivetilgang for fakturaer på dette selskapet", 403);

    // ---- Try AI extraction first ----
    let extracted: any = null;
    let extractionMethod: "ai" | "regex" = "regex";

    if (lovableKey && pdfBase64) {
      try {
        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content:
                  "Du er en ekspert på å lese norske leverandørfakturaer. Trekk ut data nøyaktig — ikke gjett. Hvis et felt mangler, returner tom streng eller utelat det.",
              },
              {
                role: "user",
                content: [
                  { type: "text", text: "Trekk ut leverandør- og fakturadata fra denne PDF-fakturaen." },
                  {
                    type: "image_url",
                    image_url: { url: `data:application/pdf;base64,${pdfBase64}` },
                  },
                ],
              },
            ],
            tools: [EXTRACTION_TOOL],
            tool_choice: { type: "function", function: { name: "extract_invoice_header" } },
          }),
        });

        if (aiResp.status === 429) return jsonErr("AI rate limit nådd, prøv igjen om litt", 429);
        if (aiResp.status === 402) return jsonErr("AI-credits oppbrukt — fyll på i Workspace-innstillinger", 402);

        if (aiResp.ok) {
          const aiData = await aiResp.json();
          const toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall?.function?.arguments) {
            extracted = JSON.parse(toolCall.function.arguments);
            extractionMethod = "ai";
          }
        } else {
          const t = await aiResp.text();
          console.warn("AI extraction failed:", aiResp.status, t);
        }
      } catch (e) {
        console.warn("AI extraction error, falling back to regex:", e);
      }
    }

    // ---- Fallback: regex on plain text ----
    if (!extracted && fallbackText) {
      const text = fallbackText;
      const orgMatch =
        text.match(/(?:org\.?\s*nr\.?|organisasjonsnr\.?|foretaksnr\.?)[:\s]*([0-9 ]{9,12})/i) ??
        text.match(/\b(\d{3}\s?\d{3}\s?\d{3})\b/);
      const invNoMatch =
        text.match(/(?:faktura(?:nr|nummer)\.?|invoice\s*no\.?)[:\s]*([A-Z0-9\-]+)/i);
      const dateMatch =
        text.match(/(?:fakturadato|invoice\s*date)[:\s]*(\d{2}[.\/-]\d{2}[.\/-]\d{4})/i) ??
        text.match(/(\d{2}[.\/-]\d{2}[.\/-]\d{4})/);
      const totalMatch =
        text.match(/(?:total(?:t)?(?:\s+å\s+betale)?|sum\s+å\s+betale|å\s+betale)[:\s]*([\d\s.,]+)/i);

      // First non-empty line as supplier name (heuristic)
      const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 2 && l.length < 80);

      extracted = {
        supplier_name: firstLine ?? "",
        supplier_org_number: orgMatch?.[1]?.replace(/\s/g, "") ?? "",
        invoice_number: invNoMatch?.[1] ?? "",
        invoice_date: dateMatch?.[1] ? toIsoDate(dateMatch[1]) : "",
        due_date: "",
        total_amount: totalMatch?.[1] ? parseNorNumber(totalMatch[1]) : 0,
        total_vat: 0,
        currency: "NOK",
        confidence: orgMatch ? "low" : "low",
      };
      extractionMethod = "regex";
    }

    if (!extracted) return jsonErr("Klarte ikke å lese PDF-en", 422);

    const orgNumber = normalizeOrgNumber(extracted.supplier_org_number);

    // ---- Match supplier ----
    let matchedSupplier: { id: string; name: string; org_number: string | null } | null = null;
    if (orgNumber) {
      const { data: sup } = await supabaseAdmin
        .from("suppliers")
        .select("id, name, org_number")
        .eq("legal_entity_id", legalEntityId)
        .eq("org_number", orgNumber)
        .limit(1);
      if (sup && sup.length > 0) matchedSupplier = sup[0];
    }
    // Fallback: name match (case-insensitive) if no org match
    let nameMatchedSupplier: { id: string; name: string; org_number: string | null } | null = null;
    if (!matchedSupplier && extracted.supplier_name) {
      const { data: sup } = await supabaseAdmin
        .from("suppliers")
        .select("id, name, org_number")
        .eq("legal_entity_id", legalEntityId)
        .ilike("name", extracted.supplier_name.trim())
        .limit(1);
      if (sup && sup.length > 0) nameMatchedSupplier = sup[0];
    }

    return new Response(
      JSON.stringify({
        extraction_method: extractionMethod,
        confidence: extracted.confidence ?? "low",
        extracted: {
          supplier_name: extracted.supplier_name ?? "",
          supplier_org_number: orgNumber ?? "",
          invoice_number: extracted.invoice_number ?? "",
          invoice_date: extracted.invoice_date ?? "",
          due_date: extracted.due_date ?? "",
          total_amount: extracted.total_amount ?? 0,
          total_vat: extracted.total_vat ?? 0,
          currency: extracted.currency ?? "NOK",
        },
        matched_supplier: matchedSupplier,
        name_matched_supplier: nameMatchedSupplier,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("parse-pdf-invoice error:", e);
    return jsonErr((e as Error).message ?? "Ukjent feil", 500);
  }
});

function toIsoDate(s: string): string {
  // Accept dd.mm.yyyy, dd/mm/yyyy, dd-mm-yyyy
  const m = s.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseNorNumber(s: string): number {
  const cleaned = s.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
