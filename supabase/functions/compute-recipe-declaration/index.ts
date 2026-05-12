// Bakoverkompatibel proxy: tar imot recipe_id, slår opp primær product_recipe_link og kaller compute-product-declaration.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { recipe_id } = await req.json();
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!recipe_id) return new Response(JSON.stringify({ error: "recipe_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: link } = await service
      .from("product_recipe_links")
      .select("id")
      .eq("recipe_id", recipe_id)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!link) return new Response(JSON.stringify({ error: "No product link for recipe" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/compute-product-declaration`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ product_recipe_link_id: link.id }),
    });
    const text = await r.text();
    return new Response(text, { status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("compute-recipe-declaration", e);
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
