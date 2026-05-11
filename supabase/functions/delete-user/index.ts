import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json(401, { error: "Invalid session" });
    const callerId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: ownerCheck, error: ownerErr } = await admin.rpc("is_platform_owner", {
      _user_id: callerId,
    });
    if (ownerErr) return json(500, { error: "internal_error" });
    if (!ownerCheck) return json(403, { error: "Kun eiere kan slette brukere" });

    const { user_id } = (await req.json()) as { user_id?: string };
    if (!user_id || typeof user_id !== "string") {
      return json(400, { error: "Mangler user_id" });
    }
    if (user_id === callerId) {
      return json(400, { error: "Du kan ikke slette deg selv" });
    }

    // Terminate active positions (set valid_to = today) — soft delete trail
    const today = new Date().toISOString().slice(0, 10);
    await admin
      .from("user_positions")
      .update({ valid_to: today })
      .eq("user_id", user_id)
      .or(`valid_to.is.null,valid_to.gt.${today}`);

    // Delete from auth — cascade should handle public.users if FK is set; else delete after
    const { error: delAuthErr } = await admin.auth.admin.deleteUser(user_id);
    if (delAuthErr) {
      // Continue anyway to attempt profile cleanup
      console.error("auth delete error:", delAuthErr.message);
    }

    // Ensure public.users row is gone / status archived
    const { error: delProfileErr } = await admin
      .from("users")
      .update({ status: "deleted" })
      .eq("id", user_id);
    if (delProfileErr) console.error("profile update error:", delProfileErr.message);

    return json(200, { success: true });
  } catch (_e) {
    return json(500, { error: "internal_error" });
  }
});
