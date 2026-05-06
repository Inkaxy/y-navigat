// Returns a fresh Tripletex session token for a given legal_entity_id.
// Caches the token in tripletex_credentials.session_token until ~30 min before expiry.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decryptToken, createSessionToken } from "../_shared/tripletex-crypto.ts";

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
    const { data: row, error } = await supabase
      .from("tripletex_credentials")
      .select("*")
      .eq("legal_entity_id", legal_entity_id)
      .maybeSingle();
    if (error) throw error;
    if (!row) {
      return new Response(JSON.stringify({ error: "Tripletex ikke konfigurert for dette selskapet" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = Date.now();
    const expiresAt = row.session_expires_at ? new Date(row.session_expires_at).getTime() : 0;
    const stillValid = row.session_token && expiresAt - now > 30 * 60 * 1000;
    if (stillValid) {
      return new Response(JSON.stringify({ token: row.session_token, expires_at: row.session_expires_at }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const employeeToken = await decryptToken(row.employee_token_encrypted);
    const consumerToken = row.mode === "private"
      ? employeeToken
      : await decryptToken(row.consumer_token_encrypted);
    const session = await createSessionToken(consumerToken, employeeToken);
    const expiresAtIso = new Date(`${session.expirationDate}T23:59:59Z`).toISOString();
    await supabase
      .from("tripletex_credentials")
      .update({ session_token: session.token, session_expires_at: expiresAtIso })
      .eq("legal_entity_id", legal_entity_id);

    return new Response(JSON.stringify({ token: session.token, expires_at: expiresAtIso }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
