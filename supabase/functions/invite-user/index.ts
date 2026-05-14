import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { decryptToken, encryptToken, refreshAccessToken } from "../_shared/m365-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const INVITE_FROM_EMAIL = "NBOS@nottero-bakeri.no";

interface Assignment {
  legal_entity_id: string;
  position_id: string;
}
interface InvitePayload {
  email: string;
  first_name: string;
  last_name: string;
  assignments: Assignment[];
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function getGraphAccessToken(admin: ReturnType<typeof createClient>): Promise<string> {
  const tenantId = Deno.env.get("MICROSOFT_GRAPH_TENANT_ID");
  const clientId = Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID");
  const clientSecret = Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET");
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Microsoft Graph er ikke konfigurert (mangler MICROSOFT_GRAPH_*-secrets)");
  }

  const { data: tokenRow, error } = await admin
    .from("microsoft_oauth_tokens")
    .select("id, account_email, access_token_encrypted, refresh_token_encrypted, expires_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Kunne ikke lese Microsoft-token: ${error.message}`);
  if (!tokenRow) throw new Error("Microsoft 365 er ikke koblet til. Koble til i /ordre/innstillinger.");

  let accessToken = await decryptToken(tokenRow.access_token_encrypted as string);
  const expiresSoon = new Date(tokenRow.expires_at as string).getTime() - Date.now() < 5 * 60 * 1000;
  if (expiresSoon) {
    const refresh = await decryptToken(tokenRow.refresh_token_encrypted as string);
    const fresh = await refreshAccessToken({ tenantId, clientId, clientSecret, refreshToken: refresh });
    accessToken = fresh.access_token;
    await admin
      .from("microsoft_oauth_tokens")
      .update({
        access_token_encrypted: await encryptToken(fresh.access_token),
        refresh_token_encrypted: await encryptToken(fresh.refresh_token ?? refresh),
        expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
        last_refresh_at: new Date().toISOString(),
      })
      .eq("id", tokenRow.id as string);
  }
  return accessToken;
}

function buildInviteHtml(opts: { first_name: string; display_name: string; invite_url: string }): string {
  const safeUrl = opts.invite_url.replace(/"/g, "&quot;");
  return `
<!doctype html>
<html><body style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1c1814; line-height: 1.5;">
  <p>Hei ${opts.first_name},</p>
  <p>Du er invitert til <strong>NBhub</strong> — Nøtterø Bakeris interne plattform.</p>
  <p>Klikk på lenken under for å sette passord og fullføre kontoen din:</p>
  <p>
    <a href="${safeUrl}" style="display:inline-block;background:#8d5a2b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
      Aktiver konto
    </a>
  </p>
  <p style="font-size:12px;color:#6b6b6b;">Hvis knappen ikke fungerer, kopier denne lenken inn i nettleseren din:<br/>
    <span style="word-break:break-all;">${safeUrl}</span>
  </p>
  <p style="font-size:12px;color:#6b6b6b;">Lenken er gyldig i en begrenset periode. Hvis du ikke forventet denne invitasjonen, kan du ignorere e-posten.</p>
  <p style="font-size:12px;color:#6b6b6b;">— NBhub / Nøtterø Bakeri</p>
</body></html>`.trim();
}

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
    if (ownerErr) return json(500, { error: ownerErr.message });
    if (!ownerCheck) return json(403, { error: "Kun eiere kan invitere brukere" });

    const body = (await req.json()) as Partial<InvitePayload>;
    const required = ["email", "first_name", "last_name"] as const;
    for (const f of required) {
      if (!body[f] || typeof body[f] !== "string") {
        return json(400, { error: `Mangler felt: ${f}` });
      }
    }
    if (!Array.isArray(body.assignments) || body.assignments.length === 0) {
      return json(400, { error: "Minst én stilling må oppgis" });
    }
    for (const a of body.assignments) {
      if (!a?.legal_entity_id || !a?.position_id) {
        return json(400, { error: "Hver stilling må ha selskap og stilling" });
      }
    }
    const email = body.email!.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(400, { error: "Ugyldig e-postadresse" });
    }

    const display_name = `${body.first_name!.trim()} ${body.last_name!.trim()}`.trim();
    const origin = req.headers.get("origin") ?? "https://nbhub.no";
    const redirectTo = `${origin}/auth/accept-invite`;

    // 1) Opprett bruker i auth + generer invitasjons-lenke (sender IKKE e-post via Supabase)
    let newUserId: string | null = null;
    let inviteUrl: string | null = null;

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        data: { first_name: body.first_name, last_name: body.last_name, display_name },
        redirectTo,
      },
    });

    if (linkData?.user) {
      newUserId = linkData.user.id;
      inviteUrl = linkData.properties?.action_link ?? null;
    } else if (linkErr && /already.*registered|already exists|already been registered/i.test(linkErr.message)) {
      // Bruker finnes — generer recovery-lenke i stedet (passord-reset fungerer som re-invite)
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (listErr) return json(500, { error: listErr.message });
      const existing = list.users.find((u) => u.email?.toLowerCase() === email);
      if (!existing) {
        return json(400, { error: "Bruker finnes i auth, men kunne ikke finnes via listUsers" });
      }
      newUserId = existing.id;
      const { data: rec, error: recErr } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      });
      if (recErr) return json(500, { error: `Kunne ikke generere lenke: ${recErr.message}` });
      inviteUrl = rec.properties?.action_link ?? null;
    } else {
      return json(400, { error: linkErr?.message ?? "Kunne ikke opprette invitasjon" });
    }

    if (!inviteUrl) return json(500, { error: "Mangler invitasjons-lenke fra Supabase" });

    // 2) Opprett profil-rad
    const { error: insErr } = await admin.from("users").insert({
      id: newUserId,
      display_name,
      first_name: body.first_name,
      last_name: body.last_name,
      email,
      status: "onboarding",
    });
    if (insErr && !insErr.message.includes("duplicate")) {
      return json(500, { error: `Bruker opprettet i auth, men feilet å lagre profil: ${insErr.message}` });
    }

    // 3) Tilordne stillinger
    const today = new Date().toISOString().slice(0, 10);
    const rows = body.assignments!.map((a, idx) => ({
      user_id: newUserId,
      position_id: a.position_id,
      legal_entity_id: a.legal_entity_id,
      is_primary: idx === 0,
      valid_from: today,
      assigned_by: callerId,
      outlet_scope: "all",
      outlet_ids: [],
    }));
    const { error: posErr } = await admin.from("user_positions").insert(rows);
    if (posErr && !posErr.message.includes("duplicate")) {
      return json(500, { error: `Stillinger kunne ikke tilordnes: ${posErr.message}` });
    }

    // 4) Send invitasjons-e-post via Microsoft Graph (NBOS@nottero-bakeri.no)
    let emailSent = false;
    let emailError: string | null = null;
    try {
      const accessToken = await getGraphAccessToken(admin);
      const html = buildInviteHtml({
        first_name: body.first_name!.trim(),
        display_name,
        invite_url: inviteUrl,
      });
      const message = {
        subject: "Velkommen til NBhub – aktiver kontoen din",
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: email } }],
      };
      const graphRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(INVITE_FROM_EMAIL)}/sendMail`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message, saveToSentItems: true }),
        },
      );
      if (!graphRes.ok) {
        const errTxt = await graphRes.text();
        emailError = `Graph sendMail feilet (${graphRes.status}): ${errTxt.slice(0, 400)}`;
      } else {
        await graphRes.text();
        emailSent = true;
      }
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e);
    }

    return json(200, {
      success: true,
      user_id: newUserId,
      email_sent: emailSent,
      email_error: emailError,
      sent_from: emailSent ? INVITE_FROM_EMAIL : null,
      // Returner lenken slik at admin kan kopiere/dele manuelt om e-post feiler
      invite_url: emailSent ? null : inviteUrl,
    });
  } catch (e) {
    console.error("invite-user", e);
    return json(500, { error: e instanceof Error ? e.message : "internal_error" });
  }
});
