// microsoft-oauth-init: starter OAuth-flyt mot Azure AD for Microsoft Graph.
// Returnerer authorization URL som klient redirecter brukeren til.
// Krav: Ordrekontor eller Daglig leder.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildAuthorizationUrl } from "../_shared/m365-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization" }, 401);
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) return json({ error: "Invalid session" }, 401);

    const { data: hasAccess } = await userClient.rpc("has_ordre_settings_access");
    if (!hasAccess) return json({ error: "Forbidden" }, 403);

    const tenantId = Deno.env.get("MICROSOFT_GRAPH_TENANT_ID");
    const clientId = Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID");
    const redirectUri = Deno.env.get("MICROSOFT_GRAPH_REDIRECT_URI");
    if (!tenantId || !clientId || !redirectUri) {
      return json({
        error: "Microsoft Graph er ikke konfigurert. Mangler MICROSOFT_GRAPH_TENANT_ID, MICROSOFT_GRAPH_CLIENT_ID eller MICROSOFT_GRAPH_REDIRECT_URI.",
      }, 500);
    }

    // CSRF-state: signert med user-id + timestamp.
    const state = `${userData.user.id}.${Date.now()}.${crypto.randomUUID()}`;
    const url = buildAuthorizationUrl({ tenantId, clientId, redirectUri, state });

    return json({ authorization_url: url, state });
  } catch (e) {
    console.error("microsoft-oauth-init error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
