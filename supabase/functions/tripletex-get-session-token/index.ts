// Returns a fresh Tripletex session token for a given legal_entity_id.
// Delegates to the shared client which caches until ~30 min before expiry.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getSessionToken } from "../_shared/tripletex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { legal_entity_id } = await req.json();
    if (!legal_entity_id) {
      return new Response(JSON.stringify({ error: "legal_entity_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const token = await getSessionToken(supabase, legal_entity_id);
    const { data: row } = await supabase
      .from("tripletex_credentials")
      .select("session_expires_at")
      .eq("legal_entity_id", legal_entity_id)
      .maybeSingle();
    return new Response(JSON.stringify({ token, expires_at: row?.session_expires_at ?? null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
