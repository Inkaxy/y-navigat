import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const negotiationId = body?.negotiation_id;
    if (!negotiationId || typeof negotiationId !== "string") {
      return new Response(JSON.stringify({ error: "negotiation_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get negotiation + recipients (RLS scopes us)
    const { data: neg, error: negErr } = await supabase
      .from("negotiations")
      .select("id, status, title, response_deadline")
      .eq("id", negotiationId)
      .maybeSingle();
    if (negErr || !neg) {
      return new Response(JSON.stringify({ error: "Negotiation not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: recipients, error: recErr } = await supabase
      .from("negotiation_recipients")
      .select("id, supplier_id, contact_email, suppliers!inner(name)")
      .eq("negotiation_id", negotiationId);
    if (recErr) throw recErr;
    if (!recipients || recipients.length === 0) {
      return new Response(JSON.stringify({ error: "Ingen leverandører å sende til" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const portalBase = req.headers.get("origin") ?? "";
    const credentials: any[] = [];

    for (const r of recipients as any[]) {
      // Generate password via SECURITY DEFINER RPC
      const { data: pw, error: pwErr } = await supabase.rpc("set_rfq_password", {
        p_recipient_id: r.id,
      });
      if (pwErr) throw pwErr;

      // Read token back
      const { data: tok } = await supabase
        .from("negotiation_recipients")
        .select("access_token")
        .eq("id", r.id)
        .single();

      credentials.push({
        recipient_id: r.id,
        supplier_id: r.supplier_id,
        supplier_name: r.suppliers?.name ?? "",
        contact_email: r.contact_email,
        access_token: tok?.access_token,
        password: pw,
        portal_url: `${portalBase}/tilbud/${tok?.access_token}`,
      });
    }

    // Move negotiation to invited if currently draft
    if (neg.status === "draft") {
      await supabase
        .from("negotiations")
        .update({ status: "invited" })
        .eq("id", negotiationId);
    }

    // Audit log
    await supabase.from("negotiation_messages").insert(
      recipients.map((r: any) => ({
        negotiation_id: negotiationId,
        recipient_id: r.id,
        event_type: "credentials_generated",
        actor: "nbhub",
      })) as any,
    );

    return new Response(JSON.stringify({ success: true, credentials }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-rfq-credentials error", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
