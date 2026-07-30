// Creates a Microsoft Graph subscription for incoming mail on the
// connected M365 mailbox (delegated, /me/messages). Stores subscription
// metadata in ticket_subscriptions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decryptToken, encryptToken, refreshAccessToken } from "../_shared/m365-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: hasSettingsAccess } = await userClient.rpc("has_ordre_settings_access");
    if (!hasSettingsAccess) return json({ error: "Ingen tilgang" }, 403);
    console.log("microsoft-graph-subscription-create called by", user.id, user.email);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const tenantId = Deno.env.get("MICROSOFT_GRAPH_TENANT_ID");
    const clientId = Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID");
    const clientSecret = Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET");
    if (!tenantId || !clientId || !clientSecret) {
      return json({ error: "Microsoft Graph er ikke konfigurert" }, 500);
    }

    // Get + refresh token
    const { data: tokenRow, error: tokErr } = await admin
      .from("microsoft_oauth_tokens")
      .select("id, account_email, access_token_encrypted, refresh_token_encrypted, expires_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tokErr) throw new Error(tokErr.message);
    if (!tokenRow) return json({ error: "Microsoft 365 er ikke koblet til" }, 412);

    let accessToken = await decryptToken(tokenRow.access_token_encrypted);
    const expiresSoon = new Date(tokenRow.expires_at).getTime() - Date.now() < 5 * 60 * 1000;
    if (expiresSoon) {
      const refresh = await decryptToken(tokenRow.refresh_token_encrypted);
      const fresh = await refreshAccessToken({ tenantId, clientId, clientSecret, refreshToken: refresh });
      accessToken = fresh.access_token;
      await admin.from("microsoft_oauth_tokens").update({
        access_token_encrypted: await encryptToken(fresh.access_token),
        refresh_token_encrypted: await encryptToken(fresh.refresh_token ?? refresh),
        expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
        last_refresh_at: new Date().toISOString(),
      }).eq("id", tokenRow.id);
    }

    // Generate clientState secret (random)
    const clientState = crypto.randomUUID() + crypto.randomUUID();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const notificationUrl = `${supabaseUrl}/functions/v1/microsoft-graph-webhook`;

    // Delegated subscriptions: max 4230 minutes (~70h) for /me/messages
    const expirationDateTime = new Date(Date.now() + 4200 * 60 * 1000).toISOString();

    const subRes = await fetch("https://graph.microsoft.com/v1.0/subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        changeType: "created",
        notificationUrl,
        resource: "/me/mailFolders('Inbox')/messages",
        expirationDateTime,
        clientState,
      }),
    });

    if (!subRes.ok) {
      const errTxt = await subRes.text();
      return json({ error: `Graph subscription feilet (${subRes.status}): ${errTxt}` }, 502);
    }
    const sub = await subRes.json();

    const { error: insErr } = await admin.from("ticket_subscriptions").insert({
      microsoft_subscription_id: sub.id,
      resource: sub.resource,
      notification_url: notificationUrl,
      client_state: clientState,
      expiration_date_time: sub.expirationDateTime,
    });
    if (insErr) throw new Error(insErr.message);

    return json({
      success: true,
      subscription_id: sub.id,
      expires_at: sub.expirationDateTime,
      mailbox: tokenRow.account_email,
    });
  } catch (e) {
    console.error("microsoft-graph-subscription-create error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
