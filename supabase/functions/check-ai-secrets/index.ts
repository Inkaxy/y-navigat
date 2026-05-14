// Returnerer hvilke AI-secrets som er satt i miljøet — aldri selve nøkkelen.
import { createClient } from "npm:@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return jsonErr("Missing Authorization", 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return jsonErr("Not authenticated", 401);
    const { data: hasAccess } = await userClient.rpc("has_ordre_settings_access");
    if (!hasAccess) return jsonErr("Forbidden", 403);

    const anthropic = !!(Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim();
    const openai = !!(Deno.env.get("OPENAI_API_KEY") ?? "").trim();
    return new Response(JSON.stringify({ anthropic, openai }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("check-ai-secrets error", e);
    return jsonErr((e as Error).message ?? "error", 500);
  }
});
