// Bryter ned en sammensatt råvares fritekst-deklarasjon til strukturerte komponenter
// via Lovable AI Gateway med tool-calling.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Du analyserer en sammensatt råvares ingrediensdeklarasjon på norsk og bryter den ned til strukturerte komponenter med prosentandeler.

Regler:
- Hver komponent får et navn (string) og en prosent (number eller null hvis ikke oppgitt eksplisitt).
- is_explicit_percentage = true når prosent er oppgitt i parentes i kilden, ellers false.
- Hvis prosenter ikke er oppgitt for noen komponenter, returner null på alle.
- Hvis prosenter er oppgitt for noen men ikke alle: behold de eksplisitte (is_explicit_percentage=true), sett resten til null (is_explicit_percentage=false). Klienten estimerer resten basert på rekkefølge.
- Behold opprinnelig rekkefølge — den er som regel synkende mengde.
- Behold E-numre, navn på emulgatorer, fortykningsmidler osv. som de står.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { raw_material_id } = await req.json();
    if (!raw_material_id) {
      return new Response(JSON.stringify({ error: "raw_material_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: canWrite } = await userClient.rpc("has_app_write_access", { p_app_code: "ravarer" });
    if (!canWrite) return new Response(JSON.stringify({ error: "Ingen tilgang" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: rm } = await service
      .from("raw_materials")
      .select("id, name")
      .eq("id", raw_material_id)
      .maybeSingle();
    if (!rm) return new Response(JSON.stringify({ error: "Raw material not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: nutrition } = await service
      .from("raw_material_nutrition")
      .select("ingredient_declaration")
      .eq("raw_material_id", raw_material_id)
      .maybeSingle();
    const declaration = nutrition?.ingredient_declaration?.trim();
    if (!declaration) {
      return new Response(JSON.stringify({ error: "No ingredient_declaration to parse" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Råvare: ${rm.name}\n\nDeklarasjon:\n${declaration}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "save_components",
            description: "Lagrer en strukturert nedbryting av sammensatt råvare til komponenter",
            parameters: {
              type: "object",
              properties: {
                components: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      percentage: { type: ["number", "null"] },
                      is_explicit_percentage: { type: "boolean" },
                    },
                    required: ["name", "percentage", "is_explicit_percentage"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["components"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "save_components" } },
      }),
    });

    if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Rate limit – prøv igjen om litt." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (aiResp.status === 402) return new Response(JSON.stringify({ error: "AI-kreditt brukt opp." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!aiResp.ok) {
      const t = await aiResp.text();
      return new Response(JSON.stringify({ error: `AI gateway: ${t}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await aiResp.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "AI returnerte ikke strukturerte komponenter" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const args = JSON.parse(toolCall.function.arguments);
    const components: Array<{ name: string; percentage: number | null; is_explicit_percentage: boolean }> = args.components ?? [];

    if (components.length === 0) {
      return new Response(JSON.stringify({ error: "Ingen komponenter funnet" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fyll inn implisitte prosenter slik at sum = 100
    const explicitSum = components.filter((c) => c.is_explicit_percentage && c.percentage != null).reduce((s, c) => s + (c.percentage ?? 0), 0);
    const implicits = components.filter((c) => !c.is_explicit_percentage || c.percentage == null);
    if (implicits.length > 0) {
      const remaining = Math.max(0, 100 - explicitSum);
      // Fordel synkende: første implicit får mest
      const weights = implicits.map((_, i) => implicits.length - i);
      const wSum = weights.reduce((a, b) => a + b, 0);
      implicits.forEach((c, i) => {
        c.percentage = Math.round((remaining * weights[i] / wSum) * 100) / 100;
      });
    } else if (Math.abs(explicitSum - 100) > 1 && explicitSum < 100) {
      // Alle eksplisitte men sum < 100 — rør ikke (vann/luft kan utgjøre resten)
    }

    // Slett tidligere komponenter for denne råvaren før vi setter inn nye
    await service.from("raw_material_components").delete().eq("parent_raw_material_id", raw_material_id);

    const rows = components.map((c, i) => ({
      parent_raw_material_id: raw_material_id,
      primary_ingredient_name: c.name,
      percentage: Math.max(0.01, Math.min(100, Number(c.percentage) || 0.01)),
      is_explicit_percentage: c.is_explicit_percentage,
      sort_order: i,
    }));
    const { error: insertErr } = await service.from("raw_material_components").insert(rows);
    if (insertErr) {
      return new Response(JSON.stringify({ error: insertErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Marker råvaren som sammensatt og krever review
    await service.from("raw_materials").update({
      is_composite: true,
      components_reviewed_at: null,
    }).eq("id", raw_material_id);

    return new Response(JSON.stringify({ components: rows, count: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
