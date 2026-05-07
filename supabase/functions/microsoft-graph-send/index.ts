// microsoft-graph-send: skall i B.0 — full implementasjon i B.1.
// Validerer template + recipient, men sender ikke faktisk e-post ennå.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  template_key: string;
  recipient_email: string;
  variables?: Record<string, string>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) return json({ error: "Invalid session" }, 401);

    const body = (await req.json()) as Body;
    if (!body?.template_key || !body?.recipient_email) {
      return json({ error: "template_key og recipient_email er påkrevd" }, 400);
    }

    return json({
      success: false,
      reason: "not_implemented_yet",
      message: "microsoft-graph-send er et skall i B.0. Full Graph-utsending kommer i B.1.",
      validated: { template_key: body.template_key, recipient_email: body.recipient_email },
    });
  } catch (e) {
    console.error("microsoft-graph-send error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
