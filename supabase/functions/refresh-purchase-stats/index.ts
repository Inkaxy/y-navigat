// Refresher materialized views med innkjøpsstatistikk.
// Kalt fra pg_cron nattlig og fra reconcile-invoice etter godkjenning.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expected = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  if (!expected || provided !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const service = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await service.rpc("refresh_purchase_stats");
    if (error) throw new Error(error.message);
    return json({ ok: true, refreshed_at: new Date().toISOString() });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
