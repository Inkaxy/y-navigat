// microsoft-oauth-disconnect: sletter tokens og setter is_connected=false.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

    return json({ success: true });
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
