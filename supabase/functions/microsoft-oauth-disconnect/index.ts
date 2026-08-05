// microsoft-oauth-disconnect: sletter tokens og setter is_connected=false.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decryptToken, encryptToken, refreshAccessToken } from "../_shared/m365-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Hent eksisterende email_address før vi sletter
    const { data: settings } = await admin
      .from("platform_settings")
      .select("value")
      .eq("category", "ordre_email")
      .eq("key", "email_account")
      .maybeSingle();
    const accountEmail = (settings?.value as { email_address?: string } | null)?.email_address;

    // Rydd Graph-abonnement FØR tokens slettes, ellers blir de liggende igjen
    // og e-post mellom frakobling og re-tilkobling går tapt.
    let subscriptionsDeleted = 0;
    try {
      const { data: subs } = await admin.from("ticket_subscriptions").select("id, microsoft_subscription_id");
      if (subs?.length) {
        const { data: tokenRow } = await admin.from("microsoft_oauth_tokens")
          .select("id, access_token_encrypted, refresh_token_encrypted, expires_at")
          .order("updated_at", { ascending: false }).limit(1).maybeSingle();
        if (tokenRow) {
          let accessToken = await decryptToken(tokenRow.access_token_encrypted);
          if (new Date(tokenRow.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
            const refresh = await decryptToken(tokenRow.refresh_token_encrypted);
            const fresh = await refreshAccessToken({
              tenantId: Deno.env.get("MICROSOFT_GRAPH_TENANT_ID")!,
              clientId: Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID")!,
              clientSecret: Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET")!,
              refreshToken: refresh,
            });
            accessToken = fresh.access_token;
            await admin.from("microsoft_oauth_tokens").update({
              access_token_encrypted: await encryptToken(fresh.access_token),
              refresh_token_encrypted: await encryptToken(fresh.refresh_token ?? refresh),
              expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
              last_refresh_at: new Date().toISOString(),
            }).eq("id", tokenRow.id);
          }
          for (const s of subs) {
            const res = await fetch(
              `https://graph.microsoft.com/v1.0/subscriptions/${s.microsoft_subscription_id}`,
              { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
            );
            if (res.ok || res.status === 404) {
              await admin.from("ticket_subscriptions").delete().eq("id", s.id);
              subscriptionsDeleted++;
            } else {
              console.warn("disconnect: kunne ikke slette abonnement", s.microsoft_subscription_id, res.status, await res.text());
            }
          }
        } else {
          // Ingen token igjen — fjern lokale rader så de ikke fornyes.
          await admin.from("ticket_subscriptions").delete().in("id", subs.map((s) => s.id));
        }
      }
    } catch (subErr) {
      console.error("disconnect: subscription cleanup failed", subErr);
    }

    if (accountEmail) {
      await admin.from("microsoft_oauth_tokens").delete().eq("account_email", accountEmail);
    }

    await admin
      .from("platform_settings")
      .upsert({
        category: "ordre_email",
        key: "email_account",
        value: { is_connected: false },
        updated_by: userData.user.id,
      }, { onConflict: "key" });

    return json({ success: true, subscriptions_deleted: subscriptionsDeleted });
  } catch (e) {
    console.error("microsoft-oauth-disconnect error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
