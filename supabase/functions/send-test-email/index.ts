// send-test-email (B.0.2.bug.1):
// Authenticated proxy for inserting a test row in email_outbox and triggering
// process-email-outbox immediately. Bypasses RLS via service-role, but only
// after validating that the caller is logged in and has Ordre-settings access.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Bruker-klient (med JWT) for auth + RLS-bundet RPC-sjekk
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return json({ error: "Invalid token" }, 401);
    }

    // Rolle-sjekk via eksisterende SECURITY DEFINER-funksjon
    const { data: hasAccess, error: rpcErr } = await userClient.rpc("has_ordre_settings_access");
    if (rpcErr) {
      return json({ error: `Role check failed: ${rpcErr.message}` }, 500);
    }
    if (!hasAccess) {
      return json({ error: "Forbidden: krever Ordrekontor- eller Daglig leder-rolle" }, 403);
    }

    let body: { template_key?: string; recipient_email?: string; variables?: Record<string, unknown> };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Ugyldig JSON-body" }, 400);
    }
    const { template_key, recipient_email, variables } = body;
    if (!template_key || !recipient_email) {
      return json({ error: "template_key og recipient_email er påkrevd" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: row, error: insErr } = await admin
      .from("email_outbox")
      .insert([{
        template_key,
        recipient_email,
        variables: (variables ?? {}) as never,
        status: "pending",
        related_entity_type: "test",
        related_entity_id: null,
      }])
      .select("id")
      .single();
    if (insErr || !row) {
      return json({ error: `Kunne ikke opprette outbox-rad: ${insErr?.message ?? "ukjent"}` }, 500);
    }

    // Trigger process-email-outbox umiddelbart
    const res = await fetch(`${supabaseUrl}/functions/v1/process-email-outbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ outbox_id: row.id }),
    });
    const txt = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(txt); } catch { /* keep raw */ }

    if (!res.ok) {
      return json({ error: `process-email-outbox feilet (${res.status}): ${txt}`, outbox_id: row.id }, 500);
    }

    const result = parsed?.results?.[0];
    return json({
      success: result?.status === "sent",
      outbox_id: row.id,
      status: result?.status ?? "unknown",
      error: result?.error,
    });
  } catch (e) {
    console.error("send-test-email error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
