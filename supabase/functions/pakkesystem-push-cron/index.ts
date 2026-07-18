// Cron-jobb: sjekker pakkesystem_push_destinations for destinasjoner som skal ha push
// akkurat nå (push_time innenfor siste 15 min og ikke pushet enda i dag), og sender
// JSON-snapshotet fra pakkesystem-export til deres URL.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const now = new Date();
  const oslo = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Oslo" }));
  const hh = String(oslo.getHours()).padStart(2, "0");
  const mm = String(oslo.getMinutes()).padStart(2, "0");
  const nowHm = `${hh}:${mm}`;

  const { data: dests, error } = await admin
    .from("pakkesystem_push_destinations")
    .select("*")
    .eq("active", true);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }

  const results: any[] = [];

  for (const d of dests ?? []) {
    // Sammenlign push_time (hh:mm:ss) med nåtid (±10 min vindu), og krev at ikke pushet
    // for dagens leveringsdato allerede.
    const pushHm = String(d.push_time).slice(0, 5);
    const [ph, pm] = pushHm.split(":").map(Number);
    const nowMinutes = oslo.getHours() * 60 + oslo.getMinutes();
    const pushMinutes = ph * 60 + pm;
    if (Math.abs(nowMinutes - pushMinutes) > 10) continue;

    const targetDate = new Date(oslo);
    targetDate.setDate(targetDate.getDate() + (d.target_offset_days ?? 0));
    const dateStr = targetDate.toISOString().slice(0, 10);

    if (d.last_pushed_at) {
      const lastOslo = new Date(new Date(d.last_pushed_at).toLocaleString("en-US", { timeZone: "Europe/Oslo" }));
      if (lastOslo.toISOString().slice(0, 10) === oslo.toISOString().slice(0, 10)) continue;
    }

    try {
      // Hent snapshot via intern edge-funksjon-kall (bruker service-role JWT).
      const exportUrl = `${supabaseUrl}/functions/v1/pakkesystem-export?date=${dateStr}&legal_entity_id=${d.legal_entity_id}`;
      const snapRes = await fetch(exportUrl, {
        headers: { Authorization: `Bearer ${serviceKey}` },
      });
      if (snapRes.status === 409) {
        // Pakksedler ikke generert enda — vent, ikke marker som pushet.
        const body = await snapRes.text();
        await admin.from("pakkesystem_push_destinations").update({
          last_error: `Venter på pakksedler for ${dateStr}: ${body.slice(0, 200)}`,
        }).eq("id", d.id);
        results.push({ id: d.id, name: d.name, status: 409, skipped: "packing_slips_not_generated" });
        continue;
      }
      if (!snapRes.ok) {
        const body = await snapRes.text();
        throw new Error(`Snapshot failed (${snapRes.status}): ${body.slice(0, 200)}`);
      }
      const payload = await snapRes.text();

      const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
      if (d.auth_header) headers["Authorization"] = d.auth_header;
      for (const [k, v] of Object.entries((d.extra_headers ?? {}) as Record<string, unknown>)) {
        headers[k] = String(v);
      }

      const push = await fetch(d.url, {
        method: d.http_method ?? "POST",
        headers,
        body: payload,
      });

      await admin.from("pakkesystem_push_destinations").update({
        last_pushed_at: new Date().toISOString(),
        last_status_code: push.status,
        last_error: push.ok ? null : (await push.text()).slice(0, 500),
      }).eq("id", d.id);

      results.push({ id: d.id, name: d.name, status: push.status, ok: push.ok });
    } catch (e: any) {
      await admin.from("pakkesystem_push_destinations").update({
        last_pushed_at: new Date().toISOString(),
        last_status_code: 0,
        last_error: (e?.message ?? "unknown").slice(0, 500),
      }).eq("id", d.id);
      results.push({ id: d.id, name: d.name, status: 0, error: e?.message });
    }
  }

  return new Response(JSON.stringify({ checked_at: now.toISOString(), oslo_hm: nowHm, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
