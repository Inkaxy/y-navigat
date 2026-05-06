// Cron-triggered: iterates over all tripletex_credentials with sync_enabled,
// invokes tripletex-sync-invoices per entity. Skips silently when no entities are configured.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: rows } = await supabase
      .from("tripletex_credentials")
      .select("legal_entity_id, sync_enabled, sync_frequency_minutes, last_synced_at")
      .eq("sync_enabled", true);
    const due = (rows ?? []).filter((r: any) => {
      if (!r.last_synced_at) return true;
      const next = new Date(r.last_synced_at).getTime() + (r.sync_frequency_minutes ?? 60) * 60 * 1000;
      return Date.now() >= next;
    });
    if (due.length === 0) {
      return new Response(JSON.stringify({ ok: true, triggered: 0, message: "Ingen aktive Tripletex-konfigurasjoner" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/tripletex-sync-invoices`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    };
    const results = await Promise.allSettled(
      due.map((r: any) =>
        fetch(url, { method: "POST", headers, body: JSON.stringify({ legal_entity_id: r.legal_entity_id }) })
          .then((res) => res.json()),
      ),
    );
    return new Response(JSON.stringify({ ok: true, triggered: due.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
