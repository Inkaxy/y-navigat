import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { encryptToken, decryptToken, createSessionToken } from "../_shared/tripletex-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  legal_entity_id: string;
  // For "test before save" — sent in clear, not stored
  consumer_token?: string;
  employee_token?: string;
  mode?: "standard" | "private";
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
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    if (!body?.legal_entity_id) {
      return new Response(JSON.stringify({ error: "legal_entity_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller has admin invoice access on this entity (RLS enforces too).
    const { data: hasAccess, error: accessErr } = await userClient.rpc(
      "has_ravarer_invoice_access",
      { _legal_entity_id: body.legal_entity_id, _level: "admin" },
    );
    if (accessErr || !hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let consumerToken = body.consumer_token?.trim();
    let employeeToken = body.employee_token?.trim();
    let mode: "standard" | "private" = body.mode ?? "standard";

    // If tokens not provided, load saved (encrypted) ones
    if (!employeeToken) {
      const { data: row } = await supabase
        .from("tripletex_credentials")
        .select("consumer_token_encrypted, employee_token_encrypted, mode")
        .eq("legal_entity_id", body.legal_entity_id)
        .maybeSingle();
      if (!row?.employee_token_encrypted) {
        return new Response(
          JSON.stringify({ ok: false, error: "Ingen lagrede credentials. Lim inn tokens i skjemaet og prøv igjen." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      mode = (row.mode as "standard" | "private") ?? "standard";
      employeeToken = await decryptToken(row.employee_token_encrypted);
      if (mode === "standard") {
        if (!row.consumer_token_encrypted) {
          return new Response(
            JSON.stringify({ ok: false, error: "Mangler consumer token for standard-modus." }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        consumerToken = await decryptToken(row.consumer_token_encrypted);
      } else {
        consumerToken = employeeToken;
      }
    } else {
      if (mode === "private") consumerToken = employeeToken;
      if (!consumerToken) {
        return new Response(
          JSON.stringify({ ok: false, error: "Consumer token er påkrevd i standard-modus." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    try {
      const session = await createSessionToken(consumerToken!, employeeToken!);
      // Try to fetch a tiny endpoint to confirm session works
      const probe = await fetch("https://tripletex.no/v2/company/>?fields=id,name", {
        headers: {
          Authorization: "Basic " + btoa(`0:${session.token}`),
          Accept: "application/json",
        },
      });
      const probeText = await probe.text();
      if (!probe.ok) {
        return new Response(
          JSON.stringify({ ok: false, error: `Session token avvist av Tripletex (${probe.status})`, detail: probeText.slice(0, 400) }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const probeJson = JSON.parse(probeText);
      return new Response(
        JSON.stringify({
          ok: true,
          company: { id: probeJson?.value?.id, name: probeJson?.value?.name },
          session_expires: session.expirationDate,
          mode,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (e) {
      return new Response(
        JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Suppress unused-import warning when deploying
void encryptToken;
