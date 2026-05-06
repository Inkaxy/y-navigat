// Forslag til allergener basert på råvarenavn
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `Du foreslår sannsynlige allergener for en bakeri-råvare basert på navn.
Returner kun klare, sannsynlige allergener. Bruk kanoniske koder:
gluten_wheat, gluten_rye, gluten_barley, gluten_oats, milk, egg, fish, crustaceans, molluscs,
peanuts, nuts_almond, nuts_hazelnut, nuts_walnut, nuts_cashew, nuts_pecan, nuts_brazil,
nuts_pistachio, nuts_macadamia, soy, celery, mustard, sesame, lupin, sulphites.
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

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY missing" }, 500);

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
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
                      allergen: { type: "string" },
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

    const service = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: pos } = await service.from("user_positions").select("legal_entity_id").eq("user_id", userRes.user.id).limit(1).maybeSingle();
    await service.from("ai_usage_log").insert({
      provider: "lovable", model: "google/gemini-3-flash-preview",
      purpose: "allergen_suggest",
      input_tokens: aiData.usage?.prompt_tokens ?? 0,
      output_tokens: aiData.usage?.completion_tokens ?? 0,
      legal_entity_id: pos?.legal_entity_id ?? null,
      success: true,
    });

    return json(args);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
