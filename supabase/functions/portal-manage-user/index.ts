import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    const portalUrl = Deno.env.get("CUSTOMER_PORTAL_URL") ?? "https://kundeportal.nbhub.no";

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, { error: "Missing Authorization" });

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: caller, error: callerErr } = await userClient.auth.getUser();
    if (callerErr || !caller.user) return json(401, { error: "Invalid session" });

    const { action, user_id, customer_ids, role, display_name } = await req.json();
    if (!user_id) return json(400, { error: "user_id kreves" });

    const admin = createClient(supabaseUrl, serviceKey);

    switch (action) {
      case "recovery": {
        const { data: u } = await admin.auth.admin.getUserById(user_id);
        let email = u?.user?.email ?? null;
        if (!email) {
          const { data: prof } = await admin.from("portal_user_profiles").select("email").eq("user_id", user_id).maybeSingle();
          email = prof?.email ?? null;
        }
        if (!email) return json(404, { error: "Bruker ikke funnet (mangler epost i auth og profil)" });
        const { error } = await admin.auth.admin.generateLink({
          type: "recovery",
          email,
          options: { redirectTo: `${portalUrl}/tilbakestill-passord` },
        });
        if (error) return json(500, { error: error.message });
        return json(200, { success: true });
      }
      case "resend_invite": {
        const { data: u } = await admin.auth.admin.getUserById(user_id);
        let email = u?.user?.email ?? null;
        let authUser = u?.user ?? null;
        if (!email) {
          const { data: prof } = await admin.from("portal_user_profiles").select("email").eq("user_id", user_id).maybeSingle();
          email = prof?.email ?? null;
        }
        if (!email) return json(404, { error: "Bruker ikke funnet (mangler epost)" });
        const alreadyConfirmed = !!authUser?.email_confirmed_at || !!authUser?.last_sign_in_at;
        // Bruker som allerede har bekreftet konto: send magic link. Ellers: re-invite.
        const { error } = alreadyConfirmed
          ? await admin.auth.admin.generateLink({
              type: "magiclink",
              email,
              options: { redirectTo: `${portalUrl}/velg-passord` },
            })
          : await admin.auth.admin.inviteUserByEmail(email, {
              redirectTo: `${portalUrl}/velg-passord`,
            });
        if (error) return json(500, { error: error.message });
        if (!alreadyConfirmed) {
          await admin.from("portal_user_profiles").update({ status: "invited" }).eq("user_id", user_id);
        }
        return json(200, { success: true, email, mode: alreadyConfirmed ? "magiclink" : "invite" });
      }
      case "disable": {
        const { error: aerr } = await admin.auth.admin.updateUserById(user_id, {
          ban_duration: "876000h", // 100 år
        });
        if (aerr) return json(500, { error: aerr.message });
        await admin.from("portal_user_profiles").update({ status: "disabled" }).eq("user_id", user_id);
        return json(200, { success: true });
      }
      case "enable": {
        const { error: aerr } = await admin.auth.admin.updateUserById(user_id, { ban_duration: "none" });
        if (aerr) return json(500, { error: aerr.message });
        await admin.from("portal_user_profiles").update({ status: "active" }).eq("user_id", user_id);
        return json(200, { success: true });
      }
      case "update_profile": {
        const patch: Record<string, unknown> = {};
        if (typeof display_name === "string") patch.display_name = display_name;
        if (role === "kunde" || role === "admin") patch.role = role;
        if (Object.keys(patch).length === 0) return json(400, { error: "Ingenting å oppdatere" });
        const { error } = await admin.from("portal_user_profiles").update(patch).eq("user_id", user_id);
        if (error) return json(500, { error: error.message });
        return json(200, { success: true });
      }
      case "set_customers": {
        if (!Array.isArray(customer_ids)) return json(400, { error: "customer_ids kreves" });
        // Enkleste sanne synk: slett alt for bruker, sett inn ny liste
        const { error: delErr } = await admin.from("customer_portal_accounts").delete().eq("user_id", user_id);
        if (delErr) return json(500, { error: delErr.message });
        if (customer_ids.length > 0) {
          const rows = customer_ids.map((cid: string) => ({ user_id, customer_id: cid, is_active: true }));
          const { error } = await admin.from("customer_portal_accounts").insert(rows);
          if (error) return json(500, { error: error.message });
        }
        return json(200, { success: true });
      }
      case "delete": {
        await admin.from("customer_portal_accounts").delete().eq("user_id", user_id);
        await admin.from("portal_user_profiles").delete().eq("user_id", user_id);
        const { error } = await admin.auth.admin.deleteUser(user_id);
        if (error) return json(500, { error: error.message });
        return json(200, { success: true });
      }
      default:
        return json(400, { error: `Ukjent handling: ${action}` });
    }
  } catch (e) {
    console.error("portal-manage-user", e);
    return json(500, { error: (e as Error).message });
  }
});
