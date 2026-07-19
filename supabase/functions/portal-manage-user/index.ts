import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { buildPortalEmailHtml, sendGraphMail } from "../_shared/graph-mail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PORTAL_FROM_EMAIL = "NBOS@nottero-bakeri.no";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type SupabaseAdmin = ReturnType<typeof createClient>;

async function findAuthUserByEmail(admin: SupabaseAdmin, email: string) {
  const normalized = email.toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === normalized);
    if (found) return found;
    if (data.users.length < 1000) break;
  }
  return null;
}

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

    // Hjelpefunksjoner
    const resolveAuthUser = async () => {
      const { data: u } = await admin.auth.admin.getUserById(user_id);
      let email = u?.user?.email ?? null;
      let authUser = u?.user ?? null;
      let firstName: string | null = null;
      if (!email) {
        const { data: prof } = await admin
          .from("portal_user_profiles")
          .select("email, display_name")
          .eq("user_id", user_id)
          .maybeSingle();
        email = prof?.email ?? null;
        firstName = prof?.display_name?.split(" ")[0] ?? null;
      } else {
        firstName = (u?.user?.user_metadata?.display_name as string | undefined)?.split(" ")[0] ?? null;
      }
      // Reconcile hvis auth-user finnes med annen id (slettet og gjenopprettet)
      if (!authUser && email) {
        authUser = await findAuthUserByEmail(admin, email);
        if (authUser && authUser.id !== user_id) {
          await admin.from("portal_user_profiles").update({ user_id: authUser.id }).eq("user_id", user_id);
          await admin.from("customer_portal_accounts").update({ user_id: authUser.id }).eq("user_id", user_id);
        }
      }
      return { email, authUser, firstName: firstName ?? "der" };
    };

    const generateAndSend = async (opts: {
      type: "invite" | "magiclink" | "recovery";
      email: string;
      firstName: string;
      subject: string;
      intro: string;
      cta: string;
      redirect: string;
    }) => {
      let { data: linkData, error } = await admin.auth.admin.generateLink({
        type: opts.type,
        email: opts.email,
        options: { redirectTo: opts.redirect },
      });
      // Hvis invite feiler pga eksisterende bruker → fall tilbake til recovery,
      // som er riktig flow for å sette/endre passord i kundeportalen.
      if (error && /already been registered|already registered|already exists/i.test(error.message)) {
        const fallback = await admin.auth.admin.generateLink({
          type: "recovery",
          email: opts.email,
          options: { redirectTo: opts.redirect },
        });
        linkData = fallback.data;
        error = fallback.error;
      }
      if (error || !linkData?.properties?.action_link) {
        throw new Error(error?.message ?? "Kunne ikke generere lenke");
      }
      const actionUrl = linkData.properties.action_link;
      await sendGraphMail({
        admin,
        from: PORTAL_FROM_EMAIL,
        to: opts.email,
        subject: opts.subject,
        html: buildPortalEmailHtml({
          greeting_name: opts.firstName,
          intro: opts.intro,
          cta_label: opts.cta,
          action_url: actionUrl,
          footer_note: "Lenken er gyldig i 24 timer.",
        }),
      });
      return actionUrl;
    };

    switch (action) {
      case "recovery": {
        const { email, firstName } = await resolveAuthUser();
        if (!email) return json(404, { error: "Bruker ikke funnet (mangler epost)" });
        try {
          await generateAndSend({
            type: "recovery",
            email,
            firstName,
            subject: "Tilbakestill passord — Nøtterø Bakeri kundeportal",
            intro: `Vi har mottatt en forespørsel om å tilbakestille passordet til <strong>Nøtterø Bakeri kundeportal</strong> (${portalUrl.replace(/^https?:\/\//, "")}). Klikk på knappen under for å velge et nytt passord.`,
            cta: "Tilbakestill passord",
            redirect: `${portalUrl}/tilbakestill-passord`,
          });
        } catch (e) {
          return json(500, { error: (e as Error).message });
        }
        return json(200, { success: true, mode: "recovery" });
      }

      case "resend_invite": {
        const { email, authUser, firstName } = await resolveAuthUser();
        if (!email) return json(404, { error: "Bruker ikke funnet (mangler epost)" });
        try {
          await generateAndSend({
            type: "recovery",
            email,
            firstName,
            subject: "Velkommen til Nøtterø Bakeri kundeportal",
            intro: `Du er invitert til <strong>Nøtterø Bakeri kundeportal</strong> på <a href="${portalUrl}">${portalUrl.replace(/^https?:\/\//, "")}</a>. Klikk på knappen under for å sette passord og logge inn.`,
            cta: "Sett passord og logg inn",
            redirect: `${portalUrl}/velg-passord`,
          });
        } catch (e) {
          return json(500, { error: (e as Error).message });
        }
        const targetId = authUser?.id ?? user_id;
        await admin.from("portal_user_profiles").update({ status: "invited" }).eq("user_id", targetId);
        return json(200, { success: true, email, mode: "recovery" });
      }

      case "disable": {
        const { error: aerr } = await admin.auth.admin.updateUserById(user_id, { ban_duration: "876000h" });
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
