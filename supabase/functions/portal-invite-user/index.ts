import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Payload {
  email: string;
  first_name: string;
  last_name: string;
  role?: "kunde" | "admin";
  customer_ids: string[];
  resend?: boolean;
}

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

    const body = (await req.json()) as Partial<Payload>;
    const email = body.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(400, { error: "Ugyldig e-post" });
    }
    if (!body.first_name || !body.last_name) return json(400, { error: "Fornavn og etternavn kreves" });
    if (!Array.isArray(body.customer_ids) || body.customer_ids.length === 0) {
      return json(400, { error: "Minst én kunde må velges" });
    }

    const display_name = `${body.first_name.trim()} ${body.last_name.trim()}`.trim();
    const role = body.role === "admin" ? "admin" : "kunde";

    const admin = createClient(supabaseUrl, serviceKey);

    // Finn eller opprett auth-bruker
    let userId: string | null = null;
    const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const found = existing?.users?.find((u) => u.email?.toLowerCase() === email);
    if (found) {
      userId = found.id;
    } else {
      const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${portalUrl}/velg-passord`,
        data: { display_name, role, portal: true },
      });
      if (invErr || !invited?.user) {
        return json(500, { error: `Invitasjon feilet: ${invErr?.message ?? "ukjent"}` });
      }
      userId = invited.user.id;
    }

    if (body.resend && found) {
      const { error: linkErr } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${portalUrl}/velg-passord`,
      });
      if (linkErr) return json(500, { error: `Ny invitasjon feilet: ${linkErr.message}` });
    }

    // Upsert profil
    const { error: profErr } = await admin.from("portal_user_profiles").upsert(
      {
        user_id: userId,
        display_name,
        email,
        role,
        status: found ? "active" : "invited",
      },
      { onConflict: "user_id" },
    );
    if (profErr) return json(500, { error: `Profil-lagring feilet: ${profErr.message}` });

    // Sett kunde-koblinger (idempotent)
    const links = body.customer_ids.map((cid) => ({
      user_id: userId!,
      customer_id: cid,
      is_active: true,
    }));
    const { error: linkErr } = await admin
      .from("customer_portal_accounts")
      .upsert(links, { onConflict: "user_id,customer_id" });
    if (linkErr) return json(500, { error: `Kunde-koblinger feilet: ${linkErr.message}` });

    return json(200, { success: true, user_id: userId, email });
  } catch (e) {
    console.error("portal-invite-user", e);
    return json(500, { error: (e as Error).message });
  }
});
