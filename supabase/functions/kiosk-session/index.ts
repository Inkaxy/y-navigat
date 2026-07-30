// kiosk-session — minter en Supabase-sesjon for den låste kiosk-brukeren.
//
// Kiosk-terminalene har ingen personlig innlogging. Tidligere lå kiosk-brukerens
// e-post og passord i klartekst i klient-bundelen (VITE_KIOSK_*). Nå ligger de kun
// som server-secrets (KIOSK_EMAIL / KIOSK_PASSWORD), og terminalen kaller dette
// endepunktet for å få tokens.
//
// Funksjonen sørger også for at kiosk-brukerens passord til enhver tid er lik
// KIOSK_PASSWORD-secreten (rotasjon: bytt secret → neste kall setter nytt passord).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const email = Deno.env.get("KIOSK_EMAIL");
  const password = Deno.env.get("KIOSK_PASSWORD");
  if (!email || !password) {
    return json({ error: "Kiosk er ikke konfigurert (KIOSK_EMAIL/KIOSK_PASSWORD mangler)" }, 500);
  }

  const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const trySignIn = () => anonClient.auth.signInWithPassword({ email, password });

  let { data, error } = await trySignIn();

  if (error) {
    // Passordet i basen matcher ikke secreten (typisk etter rotasjon) — sett det på nytt.
    try {
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (listErr) throw listErr;
      const kioskUser = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (!kioskUser) return json({ error: "Kiosk-brukeren finnes ikke" }, 500);

      const { error: updErr } = await admin.auth.admin.updateUserById(kioskUser.id, { password });
      if (updErr) throw updErr;

      ({ data, error } = await trySignIn());
    } catch (e) {
      console.error("kiosk-session rotate error", e);
      return json({ error: "Kunne ikke logge inn kiosk-brukeren" }, 500);
    }
  }

  if (error || !data?.session) {
    console.error("kiosk-session signin error", error);
    return json({ error: "Kunne ikke logge inn kiosk-brukeren" }, 401);
  }

  return json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  });
});
