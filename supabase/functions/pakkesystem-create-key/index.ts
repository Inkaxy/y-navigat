// Oppretter en ny API-nøkkel for pakkesystem-eksporten.
// Returnerer nøkkelen ÉN gang (klartekst) — kun hash lagres i DB.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function genKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `nbps_${hex}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: isOwner } = await admin.rpc("is_platform_owner", { _user_id: userRes.user.id });
  if (!isOwner) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const { legal_entity_id, name, note } = body ?? {};
  if (!legal_entity_id || !name) {
    return new Response(JSON.stringify({ error: "legal_entity_id og name kreves" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const key = genKey();
  const keyHash = await sha256Hex(key);
  const keyPrefix = key.slice(0, 12);

  const { data, error } = await admin
    .from("pakkesystem_api_keys")
    .insert({
      legal_entity_id,
      name,
      note: note ?? null,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      created_by: userRes.user.id,
    })
    .select("id, name, key_prefix, created_at")
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ ...data, api_key: key }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
