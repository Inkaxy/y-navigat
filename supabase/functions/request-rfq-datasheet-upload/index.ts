import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token ?? "");
    const password = String(body?.password ?? "");
    const itemId = String(body?.negotiation_item_id ?? "");
    const filename = String(body?.filename ?? "datasheet.pdf");

    if (!token || !password || !itemId) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400,
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
    if (!row || row.result !== "ok") {
      return new Response(JSON.stringify({ result: row?.result ?? "invalid_token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: item } = await admin
      .from("negotiation_items")
      .select("id, negotiation_id")
      .eq("id", itemId)
      .maybeSingle();
    if (!item || item.negotiation_id !== row.negotiation_id) {
      return new Response(JSON.stringify({ error: "item_mismatch" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    const path = `${row.negotiation_id}/rfq-${itemId}-${Date.now()}-${safeName}`;

    const { data: signed, error: signErr } = await admin.storage
      .from("negotiation-datasheets")
      .createSignedUploadUrl(path);
    if (signErr) throw signErr;

    return new Response(JSON.stringify({ result: "ok", path, ...signed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("request-rfq-datasheet-upload", e);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
