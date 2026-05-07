// microsoft-oauth-callback: tar imot code+state fra Microsoft, bytter mot tokens,
// krypterer og lagrer i microsoft_oauth_tokens. Oppdaterer platform_settings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { encryptToken, exchangeCodeForToken, fetchUserProfile } from "../_shared/m365-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  code: string;
  state: string;
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

    const { data: hasAccess } = await userClient.rpc("has_ordre_settings_access");
    if (!hasAccess) return json({ error: "Forbidden" }, 403);

    const body = (await req.json()) as Body;
    if (!body?.code || !body?.state) return json({ error: "code og state er påkrevd" }, 400);

    // Verifiser at state er knyttet til denne brukeren.
    const stateUserId = body.state.split(".")[0];
    if (stateUserId !== userData.user.id) {
      return json({ error: "State mismatch — CSRF-beskyttelse utløst" }, 400);
    }

    const tenantId = Deno.env.get("MICROSOFT_GRAPH_TENANT_ID")!;
    const clientId = Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID")!;
    const clientSecret = Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET")!;
    const redirectUri = Deno.env.get("MICROSOFT_GRAPH_REDIRECT_URI")!;

    const tokens = await exchangeCodeForToken({
      tenantId, clientId, clientSecret, redirectUri, code: body.code,
    });
    const profile = await fetchUserProfile(tokens.access_token);
    const accountEmail = profile.mail ?? profile.userPrincipalName;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const accessEnc = await encryptToken(tokens.access_token);
    const refreshEnc = await encryptToken(tokens.refresh_token);

    const { error: upsertErr } = await admin
      .from("microsoft_oauth_tokens")
      .upsert({
        account_email: accountEmail,
        access_token_encrypted: accessEnc,
        refresh_token_encrypted: refreshEnc,
        expires_at: expiresAt,
        scope: tokens.scope,
        tenant_id: tenantId,
        last_refresh_at: new Date().toISOString(),
      }, { onConflict: "account_email" });
    if (upsertErr) throw new Error(`Token-lagring feilet: ${upsertErr.message}`);

    // Oppdater platform_settings.email_account
    const { error: settingsErr } = await admin
      .from("platform_settings")
      .upsert({
        category: "ordre_email",
        key: "email_account",
        value: {
          provider: "microsoft365",
          email_address: accountEmail,
          display_name: profile.displayName,
          tenant_id: tenantId,
          is_connected: true,
          connected_at: new Date().toISOString(),
        },
        updated_by: userData.user.id,
      }, { onConflict: "key" });
    if (settingsErr) throw new Error(`Settings-oppdatering feilet: ${settingsErr.message}`);

    return json({ success: true, account_email: accountEmail, display_name: profile.displayName });
  } catch (e) {
    console.error("microsoft-oauth-callback error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
