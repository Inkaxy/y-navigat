// microsoft-token-refresh: oppfrisker access tokens som utløper innen 1 time.
// Tenkt kjørt periodisk via pg_cron (oppsett gjøres separat når Henrik aktiverer).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decryptToken, encryptToken, refreshAccessToken } from "../_shared/m365-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (_req) => {
  if (_req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const expected = Deno.env.get("CRON_SECRET");
  const provided = _req.headers.get("x-cron-secret");
  if (!expected || provided !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
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

    const cutoff = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 time
    const { data: tokens, error } = await admin
      .from("microsoft_oauth_tokens")
      .select("id, account_email, refresh_token_encrypted, expires_at")
      .lt("expires_at", cutoff);
    if (error) throw new Error(`Kunne ikke lese tokens: ${error.message}`);

    const results: Array<{ account_email: string; status: string; error?: string }> = [];
    for (const row of tokens ?? []) {
      try {
        const refreshToken = await decryptToken(row.refresh_token_encrypted);
        const newTokens = await refreshAccessToken({ tenantId, clientId, clientSecret, refreshToken });
        const newExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();
        const accessEnc = await encryptToken(newTokens.access_token);
        const refreshEnc = await encryptToken(newTokens.refresh_token ?? refreshToken);
        const { error: upErr } = await admin
          .from("microsoft_oauth_tokens")
          .update({
            access_token_encrypted: accessEnc,
            refresh_token_encrypted: refreshEnc,
            expires_at: newExpiresAt,
            last_refresh_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (upErr) throw new Error(upErr.message);
        results.push({ account_email: row.account_email, status: "refreshed" });
      } catch (err) {
        results.push({
          account_email: row.account_email,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return json({ checked: tokens?.length ?? 0, results });
  } catch (e) {
    console.error("microsoft-token-refresh error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
