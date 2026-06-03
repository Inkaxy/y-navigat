import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_ATTEMPTS = 10;

interface Payload {
  email: string;
  code: string;
  password: string;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = (await req.json()) as Partial<Payload>;
    const email = (body.email ?? "").trim().toLowerCase();
    const code = (body.code ?? "").trim().replace(/\s+/g, "");
    const password = body.password ?? "";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(400, { error: "Ugyldig e-postadresse" });
    }
    if (!/^\d{6}$/.test(code)) {
      return json(400, { error: "Koden må være 6 sifre" });
    }
    if (password.length < 8) {
      return json(400, { error: "Passord må være minst 8 tegn" });
    }

    // Hent siste ubrukte invitasjon for denne e-posten
    const { data: inv, error: invErr } = await admin
      .from("user_invitations")
      .select("id, user_id, email, code_hash, expires_at, consumed_at, attempts")
      .eq("email", email)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (invErr) return json(500, { error: invErr.message });
    if (!inv) return json(404, { error: "Ingen aktiv invitasjon funnet for denne e-posten" });

    if (new Date(inv.expires_at as string).getTime() < Date.now()) {
      return json(410, { error: "Invitasjonskoden er utløpt. Be administrator sende en ny kode." });
    }
    if ((inv.attempts as number) >= MAX_ATTEMPTS) {
      return json(429, { error: "For mange forsøk. Be administrator sende en ny kode." });
    }

    const expectedHash = await sha256Hex(`${inv.user_id}:${code}`);
    if (expectedHash !== inv.code_hash) {
      await admin.from("user_invitations")
        .update({ attempts: (inv.attempts as number) + 1 })
        .eq("id", inv.id as string);
      return json(401, { error: "Feil kode" });
    }

    // Sett passord og bekreft e-post
    const { error: upErr } = await admin.auth.admin.updateUserById(inv.user_id as string, {
      password,
      email_confirm: true,
    });
    if (upErr) return json(500, { error: `Kunne ikke sette passord: ${upErr.message}` });

    // Marker invitasjon som brukt
    await admin.from("user_invitations")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", inv.id as string);

    // Aktiver profil
    await admin.from("users")
      .update({ status: "active", onboarded_at: new Date().toISOString() })
      .eq("id", inv.user_id as string);

    return json(200, { success: true, email });
  } catch (e) {
    console.error("redeem-invitation", e);
    return json(500, { error: e instanceof Error ? e.message : "internal_error" });
  }
});
