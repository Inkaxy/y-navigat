import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Assignment {
  legal_entity_id: string;
  position_id: string;
}
interface Payload {
  email: string;
  first_name: string;
  last_name: string;
  password: string;
  assignments: Assignment[];
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
    if (!ownerCheck) return json(403, { error: "Kun eiere kan opprette brukere" });

    const body = (await req.json()) as Partial<Payload>;
    for (const f of ["email", "first_name", "last_name", "password"] as const) {
      if (!body[f] || typeof body[f] !== "string") {
        return json(400, { error: `Mangler felt: ${f}` });
      }
    }
    if (body.password!.length < 8) {
      return json(400, { error: "Passord må være minst 8 tegn" });
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

    // Create user with password, auto-confirm email so they can log in immediately
    let newUserId: string | null = null;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
      user_metadata: { first_name: body.first_name, last_name: body.last_name, display_name },
    });
    if (created?.user) {
      newUserId = created.user.id;
    } else if (createErr && /already.*registered|already exists/i.test(createErr.message)) {
      return json(409, { error: "En bruker med denne e-posten finnes allerede" });
    } else {
      return json(400, { error: createErr?.message ?? "Kunne ikke opprette bruker" });
    }

    const { error: insErr } = await admin.from("users").insert({
      id: newUserId,
      display_name,
      first_name: body.first_name,
      last_name: body.last_name,
      email,
      status: "active",
    });
    if (insErr && !insErr.message.includes("duplicate")) {
      return json(500, { error: `Bruker opprettet i auth, men feilet å lagre profil: ${insErr.message}` });
    }

    const today = new Date().toISOString().slice(0, 10);
    const rows = body.assignments!.map((a, idx) => ({
      user_id: newUserId,
      position_id: a.position_id,
      legal_entity_id: a.legal_entity_id,
      is_primary: idx === 0,
      valid_from: today,
      assigned_by: callerId,
    }));
    const { error: posErr } = await admin.from("user_positions").insert(rows);
    if (posErr && !posErr.message.includes("duplicate")) {
      return json(500, { error: `Stillinger kunne ikke tilordnes: ${posErr.message}` });
    }

    return json(200, { success: true, user_id: newUserId, email });
  } catch (e) {
    console.error("create-user-with-password", e);
    return json(500, { error: "internal_error" });
  }
});
