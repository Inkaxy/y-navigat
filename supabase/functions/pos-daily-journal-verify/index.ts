// Daglig kontrolljobb: verifiserer hash-kjeden i pos_journal_events per terminal
// og logger resultatet i pos_journal_verifications. Ved brudd varsles alle
// plattform-admins via notifications-tabellen.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: terminals, error: terminalsError } = await supabase
    .from("pos_terminals")
    .select("id, terminal_code, display_name, legal_entity_id")
    .eq("status", "active");

  if (terminalsError) {
    console.error("terminals fetch failed", terminalsError);
    return new Response(JSON.stringify({ error: terminalsError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<Record<string, unknown>> = [];
  const breaches: Array<{ terminal: any; broken_at_id: number | null; total: number }> = [];

  for (const t of terminals ?? []) {
    try {
      const { data, error } = await supabase.rpc("pos_verify_journal_chain_admin", {
        p_terminal_id: t.id,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const isValid = !!row?.is_valid;
      const brokenAtId = row?.broken_at_id != null ? Number(row.broken_at_id) : null;
      const total = Number(row?.total_events ?? 0);

      await supabase.from("pos_journal_verifications").insert({
        terminal_id: t.id,
        is_valid: isValid,
        broken_at_id: brokenAtId,
        total_events: total,
      });

      results.push({ terminal_id: t.id, is_valid: isValid, broken_at_id: brokenAtId, total_events: total });
      if (!isValid) breaches.push({ terminal: t, broken_at_id: brokenAtId, total });
    } catch (e: any) {
      console.error("verify failed", t.terminal_code, e?.message);
      await supabase.from("pos_journal_verifications").insert({
        terminal_id: t.id,
        is_valid: false,
        broken_at_id: null,
        total_events: 0,
        error_message: e?.message ?? "verification error",
      });
      breaches.push({ terminal: t, broken_at_id: null, total: 0 });
    }
  }

  if (breaches.length) {
    // Varsle alle plattform-eiere (positions.is_owner = true)
    const { data: adminPositions, error: posErr } = await supabase
      .from("positions")
      .select("id")
      .eq("is_owner", true);
    if (posErr) {
      console.error("kunne ikke hente plattform-eier-posisjoner", posErr);
    }
    const positionIds = (adminPositions ?? []).map((p: any) => p.id);

    let adminUserIds: string[] = [];
    if (positionIds.length) {
      const { data: userPos } = await supabase
        .from("user_positions")
        .select("user_id")
        .in("position_id", positionIds);
      adminUserIds = Array.from(new Set((userPos ?? []).map((u: any) => u.user_id)));
    }

    if (adminUserIds.length) {
      const rows = adminUserIds.flatMap((userId) =>
        breaches.map((b) => ({
          user_id: userId,
          type: "pos.journal_chain_broken",
          title: `POS-journal brutt på terminal ${b.terminal.terminal_code}`,
          body: `Hash-kjeden validerer ikke. Første avvik ved event-id ${b.broken_at_id ?? "?"} (kontrollerte ${b.total} hendelser).`,
          link: "/pos-styring",
        })),
      );
      if (rows.length) await supabase.from("notifications").insert(rows);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, verified: results.length, breaches: breaches.length, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
