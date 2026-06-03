import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { decryptToken, encryptToken, refreshAccessToken } from "../_shared/m365-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const INVITE_FROM_EMAIL = "NBOS@nottero-bakeri.no";
const CODE_TTL_DAYS = 7;

interface Assignment {
  legal_entity_id: string;
  position_id: string;
}
interface InvitePayload {
  email: string;
  first_name: string;
  last_name: string;
  assignments: Assignment[];
  /** Hvis true: bare regenerer kode for eksisterende bruker (ikke opprett ny / ikke tilordne stillinger på nytt) */
  resend?: boolean;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateOtp(): string {
  // 6 sifre, ledende nuller tillatt
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const n = (buf[0] << 24 | buf[1] << 16 | buf[2] << 8 | buf[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, "0");
}

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

function buildInviteHtml(opts: { first_name: string; code: string; activate_url: string; days: number }): string {
  const safeUrl = opts.activate_url.replace(/"/g, "&quot;");
  const spaced = opts.code.split("").join(" ");
  return `
<!doctype html>
<html><body style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1c1814; line-height: 1.5;">
  <p>Hei ${opts.first_name},</p>
  <p>Du er invitert til <strong>NBhub</strong> — Nøtterø Bakeris interne plattform.</p>
  <p>Bruk koden under på aktiveringssiden for å sette passord og fullføre kontoen din:</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:6px;background:#f5efe6;border:1px solid #e2d6c2;border-radius:10px;padding:14px 18px;display:inline-block;color:#1c1814;">
    ${spaced}
  </p>
  <p>
    <a href="${safeUrl}" style="display:inline-block;background:#8d5a2b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
      Åpne aktiveringssiden
    </a>
  </p>
  <p style="font-size:12px;color:#6b6b6b;">Eller gå manuelt til:<br/>
    <span style="word-break:break-all;">${safeUrl}</span>
  </p>
  <p style="font-size:12px;color:#6b6b6b;">Koden er gyldig i ${opts.days} dager. Hvis du ikke forventet denne invitasjonen, kan du ignorere e-posten.</p>
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
    const resend = body.resend === true;

    for (const f of ["email", "first_name", "last_name"] as const) {
      if (!body[f] || typeof body[f] !== "string") {
        return json(400, { error: `Mangler felt: ${f}` });
      }
    }
    if (!resend) {
      if (!Array.isArray(body.assignments) || body.assignments.length === 0) {
        return json(400, { error: "Minst én stilling må oppgis" });
      }
      for (const a of body.assignments!) {
        if (!a?.legal_entity_id || !a?.position_id) {
          return json(400, { error: "Hver stilling må ha selskap og stilling" });
        }
      }
    }
    const email = body.email!.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(400, { error: "Ugyldig e-postadresse" });
    }

    const display_name = `${body.first_name!.trim()} ${body.last_name!.trim()}`.trim();
    const origin = req.headers.get("origin") ?? "https://nbhub.no";
    const activateUrl = `${origin}/aktiver?email=${encodeURIComponent(email)}`;

    // 1) Finn eller opprett auth-bruker (uten e-postbekreftelse — vi håndterer aktivering selv)
    let newUserId: string | null = null;

    // Sjekk om bruker finnes
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (listErr) return json(500, { error: listErr.message });
    const existing = list.users.find((u) => u.email?.toLowerCase() === email);

    if (existing) {
      newUserId = existing.id;
    } else {
      // Opprett uten passord; email_confirm=true så de kan logge inn etter aktivering
      const tempPw = crypto.randomUUID() + "Aa1!";
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: tempPw,
        email_confirm: true,
        user_metadata: { first_name: body.first_name, last_name: body.last_name, display_name },
      });
      if (createErr || !created?.user) {
        return json(400, { error: createErr?.message ?? "Kunne ikke opprette bruker" });
      }
      newUserId = created.user.id;
    }

    // 2) Opprett/oppdater profil-rad
    const { error: insErr } = await admin.from("users").upsert({
      id: newUserId,
      display_name,
      first_name: body.first_name,
      last_name: body.last_name,
      email,
      status: "onboarding",
    }, { onConflict: "id" });
    if (insErr) {
      return json(500, { error: `Profil-feil: ${insErr.message}` });
    }

    // 3) Tilordne stillinger (hopp over ved resend)
    if (!resend) {
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
    }

    // 4) Generer OTP, lagre hash, ugyldiggjør gamle aktive koder
    const code = generateOtp();
    const codeHash = await sha256Hex(`${newUserId}:${code}`);
    const expiresAt = new Date(Date.now() + CODE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Ugyldiggjør ubrukte koder for samme bruker
    await admin.from("user_invitations")
      .update({ consumed_at: new Date().toISOString() })
      .eq("user_id", newUserId)
      .is("consumed_at", null);

    const { error: invErr } = await admin.from("user_invitations").insert({
      user_id: newUserId,
      email,
      code_hash: codeHash,
      expires_at: expiresAt,
      created_by: callerId,
    });
    if (invErr) return json(500, { error: `Kunne ikke lagre invitasjonskode: ${invErr.message}` });

    // 5) Send e-post via Microsoft Graph
    let emailSent = false;
    let emailError: string | null = null;
    try {
      const accessToken = await getGraphAccessToken(admin);
      const html = buildInviteHtml({
        first_name: body.first_name!.trim(),
        code,
        activate_url: activateUrl,
        days: CODE_TTL_DAYS,
      });
      const message = {
        subject: "Aktiveringskode til NBhub",
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
      // Returner koden bare hvis e-post feilet, så admin kan dele manuelt
      code: emailSent ? null : code,
      activate_url: activateUrl,
      expires_at: expiresAt,
    });
  } catch (e) {
    console.error("invite-user", e);
    return json(500, { error: e instanceof Error ? e.message : "internal_error" });
  }
});
