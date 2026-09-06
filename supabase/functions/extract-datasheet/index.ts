// Ekstraherer strukturerte felter fra et datablad (PDF/bilde) via Lovable AI
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { ALLERGEN_CODES } from "../_shared/allergen-diff.ts";

/** Modellen som faktisk kalles — logges uendret i raw_material_datasheets.ai_model. */
const AI_MODEL = "google/gemini-2.5-flash";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Du er en ekspert på næringsdeklarasjoner for matprodukter. Analyser dette databladet og hent ut strukturert informasjon på norsk.

Felter å hente:
- name: produktnavn på datablad
- supplier_name: leverandør/produsent
- sku: leverandørens artikkelnummer/EAN hvis oppgitt
- package_size_value, package_size_unit: pakningsstørrelse (f.eks. 25, "kg")
- nutrition pr 100g: energy_kj, energy_kcal, fat_g, saturated_fat_g, carbs_g, sugars_g, fiber_g, protein_g, salt_g
- ingredient_declaration: full ingrediensliste som tekst
- allergens: array av { allergen: kanonisk_kode, presence: "contains"|"may_contain" }. Bruk KUN disse kodene, ordrett: ${ALLERGEN_CODES.join(", ")}
- composite_components: hvis råvaren er sammensatt, array av { name, percentage|null }
- grain_classification_hint: ett av sifted_flour|whole_grain_flour|whole_grains|wheat_bran|rye_bran|oat_bran|gluten_free_grain|other_flour|not_grain
- country_of_origin: ISO-kode hvis oppgitt
- e_numbers: array av strenger
- confidence: 0-1 hvor sikker AI er på at ekstraheringen er komplett`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { file_path, raw_material_id, batch_id } = await req.json();
    if (!file_path) return json({ error: "file_path required" }, 400);

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes.user) return json({ error: "Unauthorized" }, 401);

    const service = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Valider at file_path sitt ledende segment (legal_entity uuid) er en enhet brukeren har posisjon i
    const pathEntityId = String(file_path).split("/")[0];
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(pathEntityId)) return json({ error: "Ugyldig file_path" }, 400);
    const { data: hasPos } = await userClient.rpc("has_position_in_entity", { p_legal_entity_id: pathEntityId });
    if (!hasPos) return json({ error: "Ingen tilgang" }, 403);

    // Last ned filen og base64-encode (Gemini godtar ikke signed URLs for PDF/bilde via image_url)
    const { data: blob, error: dlErr } = await service.storage.from("raw-material-datasheets").download(file_path);
    if (dlErr || !blob) return json({ error: `Kunne ikke laste fil: ${dlErr?.message ?? "ukjent"}` }, 404);
    const buf = new Uint8Array(await blob.arrayBuffer());
    // Base64 i chunks for å unngå stack overflow på store filer
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < buf.length; i += chunkSize) {
      binary += String.fromCharCode(...buf.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    const filename = file_path.split("/").pop() ?? "file";
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const isPdf = ext === "pdf" || blob.type === "application/pdf";
    const mime = isPdf ? "application/pdf"
      : ext === "png" ? "image/png"
      : ext === "webp" ? "image/webp"
      : ext === "gif" ? "image/gif"
      : "image/jpeg";
    const dataUrl = `data:${mime};base64,${base64}`;

    // Hent legal_entity_id (fra raw_material eller user-context)
    let legalEntityId: string | null = null;
    if (raw_material_id) {
      const { data: rm } = await service.from("raw_materials").select("legal_entity_id").eq("id", raw_material_id).maybeSingle();
      legalEntityId = rm?.legal_entity_id ?? null;
    }
    if (!legalEntityId) {
      const { data: pos } = await service.from("user_positions").select("legal_entity_id").eq("user_id", userRes.user.id).limit(1).maybeSingle();
      legalEntityId = pos?.legal_entity_id ?? null;
    }
    if (!legalEntityId) return json({ error: "No legal entity context" }, 400);

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY missing" }, 500);

    // PDF: bruk OpenAI-spec "file"-type (gateway router til Gemini inline PDF). Bilder: image_url med data-URL.
    const userContent: any[] = [
      { type: "text", text: "Ekstraher strukturert informasjon fra dette databladet." },
      isPdf
        ? { type: "file", file: { filename, file_data: dataUrl } }
        : { type: "image_url", image_url: { url: dataUrl } },
    ];

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        tools: [{
          type: "function",
          function: {
            name: "save_datasheet",
            description: "Lagrer ekstrahert datablad-informasjon",
            parameters: {
              type: "object",
              properties: {
                name: { type: ["string", "null"] },
                supplier_name: { type: ["string", "null"] },
                sku: { type: ["string", "null"] },
                package_size_value: { type: ["number", "null"] },
                package_size_unit: { type: ["string", "null"] },
                nutrition: {
                  type: "object",
                  properties: {
                    energy_kj: { type: ["number", "null"] }, energy_kcal: { type: ["number", "null"] },
                    fat_g: { type: ["number", "null"] }, saturated_fat_g: { type: ["number", "null"] },
                    carbs_g: { type: ["number", "null"] }, sugars_g: { type: ["number", "null"] },
                    fiber_g: { type: ["number", "null"] }, protein_g: { type: ["number", "null"] }, salt_g: { type: ["number", "null"] },
                  },
                  additionalProperties: false,
                },
                ingredient_declaration: { type: ["string", "null"] },
                allergens: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      allergen: { type: "string", enum: [...ALLERGEN_CODES] },
                      presence: { type: "string", enum: ["contains", "may_contain"] },
                    },
                    required: ["allergen", "presence"],
                    additionalProperties: false,
                  },
                },
                composite_components: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { name: { type: "string" }, percentage: { type: ["number", "null"] } },
                    required: ["name", "percentage"],
                    additionalProperties: false,
                  },
                },
                grain_classification_hint: { type: ["string", "null"] },
                country_of_origin: { type: ["string", "null"] },
                e_numbers: { type: "array", items: { type: "string" } },
                confidence: { type: "number" },
              },
              required: ["confidence"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "save_datasheet" } },
      }),
    });

    if (aiResp.status === 429) return json({ error: "Rate limit" }, 429);
    if (aiResp.status === 402) return json({ error: "AI-kreditt brukt opp" }, 402);
    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI error", aiResp.status, t);
      let msg = t;
      try { msg = JSON.parse(t)?.error?.message ?? t; } catch { /* */ }
      return json({ error: `AI: ${msg}` }, 500);
    }

    const aiData = await aiResp.json();
    const tc = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc) return json({ error: "No structured output" }, 500);
    const extracted = JSON.parse(tc.function.arguments);
    const usage = aiData.usage ?? {};

    // Lagre datablad-rad
    const { data: ds, error: dsErr } = await service.from("raw_material_datasheets").insert({
      raw_material_id: raw_material_id ?? null,
      legal_entity_id: legalEntityId,
      file_path,
      file_name: file_path.split("/").pop(),
      supplier_name: extracted.supplier_name ?? null,
      sku: extracted.sku ?? null,
      package_size_value: extracted.package_size_value ?? null,
      package_size_unit: extracted.package_size_unit ?? null,
      ai_extracted: extracted,
      ai_model: AI_MODEL,
      ai_confidence: extracted.confidence ?? null,
      raw_ai_response: aiData,
      uploaded_by: userRes.user.id,
      batch_id: batch_id ?? null,
      status: "extracted",
      is_current: false,
    }).select("id").single();
    if (dsErr) return json({ error: dsErr.message }, 500);

    // Logg AI-bruk
    await service.from("ai_usage_log").insert({
      provider: "lovable",
      model: AI_MODEL,
      purpose: "datasheet_extract",
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
      legal_entity_id: legalEntityId,
      success: true,
    });

    return json({ datasheet_id: ds.id, extracted });
  } catch (e) {
    console.error(e);
    console.error("extract-datasheet", e);
    return json({ error: "internal_error" }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
