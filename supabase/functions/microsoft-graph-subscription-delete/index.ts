// Deletes a Microsoft Graph subscription and removes it from ticket_subscriptions.
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
    const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (!claims?.claims) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { subscription_id } = await req.json().catch(() => ({}));
    let query = admin.from("ticket_subscriptions").select("*");
    if (subscription_id) query = query.eq("microsoft_subscription_id", subscription_id);
    const { data: subs, error } = await query;
    if (error) throw new Error(error.message);
    if (!subs?.length) return json({ success: true, deleted: 0 });

    const tenantId = Deno.env.get("MICROSOFT_GRAPH_TENANT_ID")!;
    const clientId = Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID")!;
    const clientSecret = Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET")!;

    const { data: tokenRow } = await admin.from("microsoft_oauth_tokens")
      .select("id, access_token_encrypted, refresh_token_encrypted, expires_at")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!tokenRow) return json({ error: "Microsoft 365 ikke koblet" }, 412);

    let accessToken = await decryptToken(tokenRow.access_token_encrypted);
    if (new Date(tokenRow.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
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

    let deleted = 0;
    for (const s of subs) {
      const res = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${s.microsoft_subscription_id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      // 204 No Content or 404 (gone) — both are OK
      if (res.ok || res.status === 404) {
        await admin.from("ticket_subscriptions").delete().eq("id", s.id);
        deleted++;
      } else {
        console.warn("Failed to delete subscription", s.microsoft_subscription_id, res.status, await res.text());
      }
    }
    return json({ success: true, deleted });
  } catch (e) {
    console.error("subscription-delete error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
