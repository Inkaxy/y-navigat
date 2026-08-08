import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decryptToken, createSessionForMode } from "../_shared/tripletex-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Mode = "standard" | "private" | "jwt";

interface Body {
  legal_entity_id: string;
  // For "test before save" — sent in clear, not stored
  jwt_token?: string;
  consumer_token?: string;
  employee_token?: string;
  mode?: Mode;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Invalid session" }, 401);

    const body = (await req.json()) as Body;
    if (!body?.legal_entity_id) return json({ error: "legal_entity_id is required" }, 400);

    const { data: hasAccess, error: accessErr } = await userClient.rpc(
      "has_ravarer_invoice_access",
      { _legal_entity_id: body.legal_entity_id, _required_level: "admin" },
    );
    if (accessErr || !hasAccess) return json({ error: "Forbidden" }, 403);

    let mode: Mode = body.mode ?? "standard";
    let consumerToken = body.consumer_token?.trim() || undefined;
    // I jwt-modus er API-nøkkelen "employee token" mot Tripletex.
    let secretToken = (mode === "jwt" ? body.jwt_token : body.employee_token)?.trim() || undefined;

    // Ingen nøkkel i skjemaet → bruk lagrede (krypterte) verdier.
    if (!secretToken) {
      const { data: row } = await supabase
        .from("tripletex_credentials")
        .select("consumer_token_encrypted, employee_token_encrypted, mode")
        .eq("legal_entity_id", body.legal_entity_id)
        .maybeSingle();
      if (!row?.employee_token_encrypted) {
        return json({ ok: false, error: "Ingen lagrede credentials. Lim inn nøkkel i skjemaet og prøv igjen." });
      }
      mode = (row.mode as Mode) ?? "standard";
      secretToken = await decryptToken(row.employee_token_encrypted);
      if (mode === "standard") {
        if (!row.consumer_token_encrypted) {
          return json({ ok: false, error: "Mangler consumer token for standard-modus." });
        }
        consumerToken = await decryptToken(row.consumer_token_encrypted);
      } else {
        consumerToken = undefined;
      }
    } else if (mode === "standard" && !consumerToken) {
      return json({ ok: false, error: "Consumer token er påkrevd i standard-modus." });
    }

    try {
      const session = await createSessionForMode(mode, consumerToken, secretToken!);
      const probe = await fetch("https://tripletex.no/v2/company/>?fields=id,name", {
        headers: {
          Authorization: "Basic " + btoa(`0:${session.token}`),
          Accept: "application/json",
        },
      });
      const probeText = await probe.text();
      if (!probe.ok) {
        return json({
          ok: false,
          error: `Session token avvist av Tripletex (${probe.status})`,
          detail: probeText.slice(0, 400),
        });
      }
      const probeJson = JSON.parse(probeText);
      return json({
        ok: true,
        company: { id: probeJson?.value?.id, name: probeJson?.value?.name },
        session_expires: session.expirationDate,
        mode,
      });
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
