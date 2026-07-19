// Shared helper for sending mail via Microsoft Graph using the stored OAuth token.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { decryptToken, encryptToken, refreshAccessToken } from "./m365-crypto.ts";

type Admin = ReturnType<typeof createClient>;

export async function getGraphAccessToken(admin: Admin): Promise<string> {
  const tenantId = Deno.env.get("MICROSOFT_GRAPH_TENANT_ID");
  const clientId = Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID");
  const clientSecret = Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET");
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Microsoft Graph er ikke konfigurert (MICROSOFT_GRAPH_*).");
  }
  const { data: tokenRow, error } = await admin
    .from("microsoft_oauth_tokens")
    .select("id, access_token_encrypted, refresh_token_encrypted, expires_at")
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

export async function sendGraphMail(opts: {
  admin: Admin;
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const accessToken = await getGraphAccessToken(opts.admin);
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(opts.from)}/sendMail`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: opts.subject,
          body: { contentType: "HTML", content: opts.html },
          toRecipients: [{ emailAddress: { address: opts.to } }],
        },
        saveToSentItems: true,
      }),
    },
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Graph sendMail feilet (${res.status}): ${txt.slice(0, 400)}`);
  }
}

export function buildPortalEmailHtml(opts: {
  greeting_name: string;
  intro: string;
  cta_label: string;
  action_url: string;
  footer_note?: string;
}): string {
  const safeUrl = opts.action_url.replace(/"/g, "&quot;");
  return `
<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1814;line-height:1.5;">
  <p>Hei ${opts.greeting_name},</p>
  <p>${opts.intro}</p>
  <p>
    <a href="${safeUrl}" style="display:inline-block;background:#8d5a2b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
      ${opts.cta_label}
    </a>
  </p>
  <p style="font-size:12px;color:#6b6b6b;">Eller åpne lenken manuelt:<br/>
    <span style="word-break:break-all;">${safeUrl}</span>
  </p>
  ${opts.footer_note ? `<p style="font-size:12px;color:#6b6b6b;">${opts.footer_note}</p>` : ""}
  <p style="font-size:12px;color:#6b6b6b;">— Nøtterø Bakeri / Kundeportal</p>
</body></html>`.trim();
}
