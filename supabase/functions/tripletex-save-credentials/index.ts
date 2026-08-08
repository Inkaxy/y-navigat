// Saves Tripletex credentials. Encrypts tokens server-side using TRIPLETEX_ENCRYPTION_KEY.
// Only admin invoice users on the entity can write (RLS-enforced via user-scoped client).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { encryptToken } from "../_shared/tripletex-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Mode = "standard" | "private" | "jwt";

interface Body {
  legal_entity_id: string;
  mode: Mode;
  jwt_token?: string | null; // API-nøkkel (jwt-modus). Omit = behold eksisterende
  consumer_token?: string | null; // omit/null = keep existing
  employee_token?: string | null;
  sync_enabled?: boolean;
  sync_frequency_minutes?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = (await req.json()) as Body;
    if (!body?.legal_entity_id || !body?.mode) {
      return new Response(JSON.stringify({ error: "legal_entity_id og mode er påkrevd" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["standard", "private", "jwt"].includes(body.mode)) {
      return new Response(JSON.stringify({ error: "Ugyldig modus" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: hasAccess } = await userClient.rpc("has_ravarer_invoice_access", {
      _legal_entity_id: body.legal_entity_id, _required_level: "admin",
    });
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existing } = await admin
      .from("tripletex_credentials")
      .select("legal_entity_id, mode, consumer_token_encrypted, employee_token_encrypted")
      .eq("legal_entity_id", body.legal_entity_id)
      .maybeSingle();

    // API-nøkkelen lagres i employee_token_encrypted (samme kolonne, jwt-modus).
    const secretPlain = body.mode === "jwt"
      ? body.jwt_token?.trim()
      : body.employee_token?.trim();
    const conPlain = body.consumer_token?.trim();
    const keepExistingSecret = existing?.mode === body.mode ? existing?.employee_token_encrypted : undefined;

    if (!secretPlain && !keepExistingSecret) {
      return new Response(JSON.stringify({
        error: body.mode === "jwt"
          ? "API-nøkkel er påkrevd ved første oppsett"
          : "Employee token er påkrevd ved første oppsett",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (body.mode === "standard" && !conPlain && !existing?.consumer_token_encrypted) {
      return new Response(JSON.stringify({ error: "Consumer token er påkrevd i standard-modus" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const employee_token_encrypted = secretPlain
      ? await encryptToken(secretPlain)
      : keepExistingSecret;
    const consumer_token_encrypted = body.mode === "standard"
      ? (conPlain ? await encryptToken(conPlain) : existing?.consumer_token_encrypted)
      : null;

    const payload: Record<string, unknown> = {
      legal_entity_id: body.legal_entity_id,
      mode: body.mode,
      employee_token_encrypted,
      consumer_token_encrypted,
      sync_enabled: body.sync_enabled ?? false,
      sync_frequency_minutes: body.sync_frequency_minutes ?? 60,
      // Reset session cache when tokens may have changed
      session_token: null,
      session_expires_at: null,
    };

    const { error } = await admin
      .from("tripletex_credentials")
      .upsert(payload, { onConflict: "legal_entity_id" });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("tripletex-save-credentials", err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
