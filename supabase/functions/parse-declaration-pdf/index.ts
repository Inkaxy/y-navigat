// parse-declaration-pdf: tolker en PDF (deklarasjon/næringsinnhold) for et produkt
// med konfigurerbar AI-provider (Lovable AI default, OpenAI/Anthropic/Custom mulig).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  product_id: string;
  file_path: string; // path i declaration-uploads bucket
}

interface ProviderConfig {
  provider: "lovable" | "openai" | "anthropic" | "custom";
  model: string;
  base_url?: string;
}

const DEFAULT_CONFIG: ProviderConfig = {
  provider: "lovable",
  model: "google/gemini-2.5-pro",
};

const SCHEMA = {
  type: "object",
  properties: {
    ingredient_declaration: {
      type: "string",
      description: "Full ingrediensliste som tekst, allergener i CAPS eller markert med **fet** der mulig.",
    },
    nutrition_per_100g: {
      type: "object",
      properties: {
        energy_kj: { type: "number" },
        energy_kcal: { type: "number" },
        fat_g: { type: "number" },
        saturated_fat_g: { type: "number" },
        carbs_g: { type: "number" },
        sugars_g: { type: "number" },
        fiber_g: { type: "number" },
        protein_g: { type: "number" },
        salt_g: { type: "number" },
      },
    },
    allergens_contains: { type: "array", items: { type: "string" } },
    allergens_may_contain: { type: "array", items: { type: "string" } },
    confidence: {
      type: "object",
      properties: {
        ingredient: { type: "number", description: "0-1" },
        nutrition: { type: "number", description: "0-1" },
        allergens: { type: "number", description: "0-1" },
      },
    },
    notes: { type: "string", description: "Korte merknader om uklarheter eller hva som ikke ble funnet." },
  },
  required: ["ingredient_declaration", "nutrition_per_100g", "allergens_contains", "allergens_may_contain"],
};

const SYSTEM_PROMPT = `Du er en ekspert på å lese norske produktdeklarasjoner og næringstabeller fra PDF-er fra leverandører/produsenter (bakeriprodukter, ingredienser).
Din jobb er å trekke ut:
1. Ingrediensdeklarasjon (norsk) — så ordrett som mulig fra PDF-en. Marker allergener med **fet** (f.eks. **HVETE**mel, **MELK**).
2. Næringsinnhold pr 100 g — alle 9 standardfeltene hvis de finnes. Konverter enheter ved behov (kJ ↔ kcal ikke nødvendig).
3. Allergener — separate lister for "inneholder" og "kan inneholde spor av".
4. Confidence-score 0-1 pr seksjon basert på hvor tydelig dataen var i PDF-en.

Returner KUN strukturert JSON via tool-call. Ikke gjett verdier — la felter være tomme/null hvis de ikke finnes i kilden.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = (await req.json()) as Body;
    if (!body?.product_id || !body?.file_path) {
      return json({ error: "product_id og file_path er påkrevd" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) Hent AI-konfig
    const { data: cfgRow } = await admin
      .from("platform_settings")
      .select("value")
      .eq("category", "varer_ai")
      .eq("key", "provider_config")
      .maybeSingle();
    const config: ProviderConfig = (cfgRow?.value as ProviderConfig | null) ?? DEFAULT_CONFIG;

    // 2) Last ned PDF
    const { data: file, error: dlErr } = await admin.storage
      .from("declaration-uploads")
      .download(body.file_path);
    if (dlErr || !file) {
      return json({ error: `Kunne ikke laste PDF: ${dlErr?.message}` }, 404);
    }
    const pdfBytes = new Uint8Array(await file.arrayBuffer());
    const base64 = encodeBase64(pdfBytes);

    // 3) Bygg request basert på provider
    let endpoint: string;
    let apiKey: string | undefined;
    if (config.provider === "lovable") {
      endpoint = "https://ai.gateway.lovable.dev/v1/chat/completions";
      apiKey = Deno.env.get("LOVABLE_API_KEY");
    } else if (config.provider === "openai") {
      endpoint = "https://api.openai.com/v1/chat/completions";
      apiKey = Deno.env.get("CUSTOM_AI_API_KEY");
    } else if (config.provider === "anthropic") {
      endpoint = "https://api.anthropic.com/v1/messages";
      apiKey = Deno.env.get("CUSTOM_AI_API_KEY");
    } else {
      endpoint = (config.base_url ?? "").replace(/\/$/, "") + "/chat/completions";
      apiKey = Deno.env.get("CUSTOM_AI_API_KEY");
    }
    if (!apiKey) {
      return json({ error: `API-nøkkel mangler for provider '${config.provider}'. Sett CUSTOM_AI_API_KEY i secrets.` }, 412);
    }

    // 4) Kall AI med PDF som input + tool-call schema
    let parsed: Record<string, unknown> | null = null;
    let rawText: string | undefined;

    if (config.provider === "anthropic") {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          tools: [{ name: "extract_declaration", input_schema: SCHEMA }],
          tool_choice: { type: "tool", name: "extract_declaration" },
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
              { type: "text", text: "Trekk ut deklarasjon, næring og allergener fra denne PDF-en." },
            ],
          }],
        }),
      });
      const txt = await res.text();
      if (!res.ok) return json({ error: `AI feilet (${res.status}): ${txt}` }, 502);
      const data = JSON.parse(txt);
      const tool = (data?.content ?? []).find((c: { type: string }) => c.type === "tool_use");
      parsed = tool?.input ?? null;
      rawText = txt;
    } else {
      // OpenAI-kompatibel (Lovable AI, OpenAI, custom). PDF sendes som file/document part.
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "Trekk ut deklarasjon, næring og allergener fra denne PDF-en." },
                {
                  type: "file",
                  file: { filename: "declaration.pdf", file_data: `data:application/pdf;base64,${base64}` },
                },
              ],
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_declaration",
                description: "Strukturert resultat fra deklarasjon-PDF.",
                parameters: SCHEMA,
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "extract_declaration" } },
        }),
      });
      const txt = await res.text();
      if (!res.ok) {
        if (res.status === 429) return json({ error: "AI er ratebegrenset. Vent litt og prøv igjen." }, 429);
        if (res.status === 402) return json({ error: "AI-kreditt tom. Legg til kreditt i Lovable-workspace." }, 402);
        return json({ error: `AI feilet (${res.status}): ${txt}` }, 502);
      }
      const data = JSON.parse(txt);
      const call = data?.choices?.[0]?.message?.tool_calls?.[0];
      if (call?.function?.arguments) {
        try { parsed = JSON.parse(call.function.arguments); } catch { /* noop */ }
      }
      rawText = txt;
    }

    if (!parsed) {
      return json({ error: "AI returnerte ikke strukturert resultat", raw: rawText?.slice(0, 1000) }, 502);
    }

    return json({ success: true, result: parsed, provider: config.provider, model: config.model });
  } catch (e) {
    console.error("parse-declaration-pdf error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
