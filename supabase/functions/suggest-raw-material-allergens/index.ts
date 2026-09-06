// Forslag til allergener basert på råvarenavn
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { ALLERGEN_CODES, normalizeAllergenCode, normalizeAllergenPresence } from "../_shared/allergen-diff.ts";

const AI_MODEL = "google/gemini-3-flash-preview";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `Du foreslår sannsynlige allergener for en bakeri-råvare basert på navn.
Returner kun klare, sannsynlige allergener. Bruk KUN disse kodene, ordrett:
${ALLERGEN_CODES.join(", ")}.
Bare returner allergener du er rimelig sikker på (>0.6 confidence).`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { name } = await req.json();
    if (!name || name.length < 2) return json({ suggestions: [] });

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes.user) return json({ error: "Unauthorized" }, 401);

    const { data: canWrite } = await userClient.rpc("has_app_write_access", { p_app_code: "ravarer" });
    if (!canWrite) return json({ error: "Ingen tilgang" }, 403);

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY missing" }, 500);

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Råvarenavn: "${name}"` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "suggest",
            parameters: {
              type: "object",
              properties: {
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      allergen: { type: "string", enum: [...ALLERGEN_CODES] },
                      presence: { type: "string", enum: ["contains", "may_contain"] },
                      confidence: { type: "number" },
                    },
                    required: ["allergen", "presence", "confidence"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["suggestions"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest" } },
      }),
    });

    if (aiResp.status === 429) return json({ error: "Rate limit" }, 429);
    if (aiResp.status === 402) return json({ error: "AI-kreditt brukt opp" }, 402);
    if (!aiResp.ok) return json({ suggestions: [] });

    const aiData = await aiResp.json();
    const tc = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc) return json({ suggestions: [] });
    const args = JSON.parse(tc.function.arguments);
    // Valider mot enum-listen — koder AI finner på forkastes framfor å feile stille i basen.
    const rejected: string[] = [];
    const suggestions: { allergen: string; presence: string; confidence: number }[] = [];
    for (const raw of Array.isArray(args?.suggestions) ? args.suggestions : []) {
      const code = normalizeAllergenCode(raw?.allergen);
      if (!code) {
        const label = typeof raw?.allergen === "string" ? raw.allergen : String(raw?.allergen ?? "");
        if (label && !rejected.includes(label)) rejected.push(label);
        continue;
      }
      suggestions.push({
        allergen: code,
        presence: normalizeAllergenPresence(raw?.presence) ?? "contains",
        confidence: Number(raw?.confidence ?? 0),
      });
    }

    const service = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: pos } = await service.from("user_positions").select("legal_entity_id").eq("user_id", userRes.user.id).limit(1).maybeSingle();
    await service.from("ai_usage_log").insert({
      provider: "lovable", model: AI_MODEL,
      purpose: "allergen_suggest",
      input_tokens: aiData.usage?.prompt_tokens ?? 0,
      output_tokens: aiData.usage?.completion_tokens ?? 0,
      legal_entity_id: pos?.legal_entity_id ?? null,
      success: true,
    });

    return json({ suggestions, rejected });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
