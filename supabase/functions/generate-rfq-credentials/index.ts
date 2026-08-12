import { createClient } from "npm:@supabase/supabase-js@2";

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

    // Service-role client used only to read credential columns
    // (access_token / password_hash) which are revoked from authenticated/anon.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
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

    // Caller authorization has passed (auth.getUser + RLS-scoped negotiation lookup).
    // All remaining DB work runs with service role because credential columns
    // (access_token / password_hash) are revoked from authenticated/anon.
    const { data: recipients, error: recErr } = await supabaseAdmin
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
      const { data: pw, error: pwErr } = await supabaseAdmin.rpc("set_rfq_password", {
        p_recipient_id: r.id,
      });
      if (pwErr) throw pwErr;

      // Read token back via service role (column is revoked from authenticated)
      const { data: tok } = await supabaseAdmin
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
      await supabaseAdmin
        .from("negotiations")
        .update({ status: "invited" })
        .eq("id", negotiationId);
    }

    // Audit log
    await supabaseAdmin.from("negotiation_messages").insert(
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
    console.error("generate-rfq-credentials", e);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
