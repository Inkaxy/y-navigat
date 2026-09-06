import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  RFQ_ITEM_SELECT,
  RFQ_RESPONSE_SELECT,
  projectRfqItems,
  projectRfqResponses,
} from "../_shared/negotiation-projection.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// In-memory rate limit (best-effort; per edge instance)
const ipAttempts = new Map<string, { count: number; resetAt: number }>();
const tokenAttempts = new Map<string, { count: number; resetAt: number }>();

function rateCheck(map: Map<string, any>, key: string, max: number, windowMs: number) {
  const now = Date.now();
  const e = map.get(key);
  if (!e || e.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (e.count >= max) return false;
  e.count++;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ua = req.headers.get("user-agent") ?? null;
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token ?? "");
    const password = String(body?.password ?? "");

    if (!token || !password) {
      return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!rateCheck(ipAttempts, ip, 20, 60 * 60 * 1000) || !rateCheck(tokenAttempts, token, 5, 15 * 60 * 1000)) {
      return new Response(JSON.stringify({ result: "rate_limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await admin.rpc("negotiation_recipient_by_token", { p_token: token, p_password: password });
    if (error) throw error;
    const row = (data ?? [])[0];
    if (!row) return new Response(JSON.stringify({ result: "invalid_token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Audit
    await admin.from("negotiation_messages").insert({
      negotiation_id: row.negotiation_id ?? null,
      recipient_id: row.recipient_id ?? null,
      event_type: row.result === "ok" ? "access_success" : `access_${row.result}`,
      actor: "supplier",
      ip_address: ip,
      user_agent: ua,
    } as any);

    if (row.result !== "ok") {
      return new Response(JSON.stringify({ result: row.result }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Issue short-lived session token (signed payload, kept simple — random + DB store)
    const session = crypto.randomUUID().replace(/-/g, "");
    await admin.from("negotiation_messages").insert({
      negotiation_id: row.negotiation_id,
      recipient_id: row.recipient_id,
      event_type: "session_issued",
      actor: "system",
      payload: { session, expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    } as any);

    // Load full bundle: items + existing draft responses + supplier name + raw materials
    const { data: items } = await admin
      .from("negotiation_items")
      .select(RFQ_ITEM_SELECT)
      .eq("negotiation_id", row.negotiation_id)
      .order("sort_order");
    const { data: responses } = await admin
      .from("negotiation_responses")
      .select(RFQ_RESPONSE_SELECT)
      .eq("recipient_id", row.recipient_id);
    const { data: supplier } = await admin
      .from("suppliers")
      .select("name")
      .eq("id", row.supplier_id)
      .maybeSingle();

    return new Response(JSON.stringify({
      result: "ok",
      session,
      recipient_id: row.recipient_id,
      negotiation_id: row.negotiation_id,
      negotiation_title: row.negotiation_title,
      response_deadline: row.response_deadline,
      supplier_name: supplier?.name ?? null,
      items: projectRfqItems(items),
      responses: projectRfqResponses(responses),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("validate-rfq-access", e);
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
