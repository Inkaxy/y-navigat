import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { LIVE_ITEM_SELECT, projectLiveItems } from "../_shared/negotiation-projection.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token ?? "");
    const password = String(body?.password ?? "");

    if (!token || !password) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!rateCheck(ipAttempts, ip, 20, 60 * 60 * 1000) || !rateCheck(tokenAttempts, token, 5, 15 * 60 * 1000)) {
      return new Response(JSON.stringify({ result: "rate_limited" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await admin.rpc("negotiation_recipient_by_token", {
      p_token: token,
      p_password: password,
    });
    if (error) throw error;
    const row = (data ?? [])[0];
    if (!row) {
      return new Response(JSON.stringify({ result: "invalid_token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (row.result !== "ok") {
      return new Response(JSON.stringify({ result: row.result }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Confirm this is a live negotiation
    const { data: neg } = await admin
      .from("negotiations")
      .select("id, title, negotiation_mode, live_confirmation_deadline, live_session_ended_at, status")
      .eq("id", row.negotiation_id)
      .maybeSingle();
    if (!neg || neg.negotiation_mode !== "live") {
      return new Response(JSON.stringify({ result: "wrong_mode" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const session = crypto.randomUUID().replace(/-/g, "");

    // Load only items relevant for confirmation
    const { data: items } = await admin
      .from("negotiation_items")
      .select(LIVE_ITEM_SELECT)
      .eq("negotiation_id", row.negotiation_id)
      .in("live_status", ["tentatively_agreed", "confirmed", "unconfirmed_active"])
      .order("sort_order");

    const { data: supplier } = await admin
      .from("suppliers")
      .select("name")
      .eq("id", row.supplier_id)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        result: "ok",
        session,
        recipient_id: row.recipient_id,
        negotiation_id: row.negotiation_id,
        negotiation_title: neg.title,
        confirmation_deadline: neg.live_confirmation_deadline,
        ended_at: neg.live_session_ended_at,
        supplier_name: supplier?.name ?? null,
        items: projectLiveItems(items),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("validate-live-confirmation-access", e);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
