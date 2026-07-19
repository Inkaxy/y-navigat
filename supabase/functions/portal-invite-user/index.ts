import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { buildPortalEmailHtml, sendGraphMail } from "../_shared/graph-mail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PORTAL_FROM_EMAIL = "NBOS@nottero-bakeri.no";

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

function normalizePortalUrl(value: string | undefined | null) {
  const fallback = "https://kundeportal.nbhub.no";
  try {
    const url = new URL(value ?? fallback);
    if (url.hostname !== "kundeportal.nbhub.no") return fallback;
    url.pathname = url.pathname.replace(/\/login\/?$/, "").replace(/\/$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

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
    const portalUrl = normalizePortalUrl(Deno.env.get("CUSTOMER_PORTAL_URL"));

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

    // 1) Finn eller opprett auth-bruker (uten å sende Supabase-epost)
    let userId: string | null = null;
    let isNew = false;
    const found = await findAuthUserByEmail(admin, email);
    if (found) {
      userId = found.id;
    } else {
      const tempPw = crypto.randomUUID() + "Aa1!";
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: tempPw,
        email_confirm: true,
        user_metadata: { display_name, role, portal: true },
      });
      if (createErr || !created?.user) {
        return json(500, { error: `Kunne ikke opprette bruker: ${createErr?.message ?? "ukjent"}` });
      }
      userId = created.user.id;
      isNew = true;
    }

    // 2) Upsert profil
    const { error: profErr } = await admin.from("portal_user_profiles").upsert(
      {
        user_id: userId,
        display_name,
        email,
        role,
        status: isNew ? "invited" : "active",
      },
      { onConflict: "user_id" },
    );
    if (profErr) return json(500, { error: `Profil-lagring feilet: ${profErr.message}` });

    // 3) Kunde-koblinger
    const links = body.customer_ids.map((cid) => ({
      user_id: userId!,
      customer_id: cid,
      is_active: true,
    }));
    const { error: linkErr } = await admin
      .from("customer_portal_accounts")
      .upsert(links, { onConflict: "user_id,customer_id" });
    if (linkErr) return json(500, { error: `Kunde-koblinger feilet: ${linkErr.message}` });

    // 4) Generer action-link som lander på kundeportalen og send via Graph
    //    (bypass Supabase sin default-epost slik at vi kontrollerer URL-en 100%)
    // Bruk recovery-lenke også ved førstegangsoppsett: den gir bruker en trygg
    // session på kundeportal.nbhub.no og lar dem sette eget passord uten Supabase-invite-email.
    const { data: linkData, error: linkGenErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${portalUrl}/velg-passord` },
    });
    if (linkGenErr || !linkData?.properties?.action_link) {
      return json(500, {
        error: `Kunne ikke generere lenke: ${linkGenErr?.message ?? "ukjent"}`,
      });
    }
    const actionUrl = linkData.properties.action_link;

    let emailSent = false;
    let emailError: string | null = null;
    try {
      await sendGraphMail({
        admin,
        from: PORTAL_FROM_EMAIL,
        to: email,
        subject: "Velkommen til Nøtterø Bakeri kundeportal",
        html: buildPortalEmailHtml({
          greeting_name: body.first_name.trim(),
          intro: `Du er invitert til <strong>Nøtterø Bakeri kundeportal</strong> på <a href="${portalUrl}">${portalUrl.replace(/^https?:\/\//, "")}</a>. Klikk på knappen under for å sette passord og logge inn.`,
          cta_label: "Sett passord og logg inn",
          action_url: actionUrl,
          footer_note: "Lenken er gyldig i 24 timer. Har du ikke ventet denne invitasjonen kan du ignorere e-posten.",
        }),
      });
      emailSent = true;
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e);
    }

    return json(200, {
      success: true,
      user_id: userId,
      email,
      email_sent: emailSent,
      email_error: emailError,
      mode: "recovery",
      // Returner action_url så admin kan dele manuelt hvis e-posten feilet
      action_url: emailSent ? null : actionUrl,
    });
  } catch (e) {
    console.error("portal-invite-user", e);
    return json(500, { error: (e as Error).message });
  }
});
