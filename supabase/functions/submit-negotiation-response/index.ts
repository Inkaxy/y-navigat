import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const { token, password, responses, finalize } = body ?? {};
    if (!token || !password || !Array.isArray(responses)) {
      return new Response(JSON.stringify({ error: "invalid_payload" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await admin.rpc("negotiation_recipient_by_token", { p_token: token, p_password: password });
    if (error) throw error;
    const row = (data ?? [])[0];
    if (!row || row.result !== "ok") {
      return new Response(JSON.stringify({ result: row?.result ?? "invalid_token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check if already submitted -> reject unless unlocked
    const { data: existing } = await admin
      .from("negotiation_responses")
      .select("id, status")
      .eq("recipient_id", row.recipient_id);
    const anySubmitted = (existing ?? []).some((r: any) => r.status === "submitted");
    if (anySubmitted) {
      return new Response(JSON.stringify({ result: "already_submitted" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const status = finalize ? "submitted" : "draft";
    const submittedAt = finalize ? new Date().toISOString() : null;

    // Upsert each response
    for (const r of responses) {
      const payload = {
        negotiation_id: row.negotiation_id,
        recipient_id: row.recipient_id,
        negotiation_item_id: r.negotiation_item_id,
        offered_price: r.offered_price ?? null,
        offered_package_size: r.offered_package_size ?? null,
        offered_package_unit: r.offered_package_unit ?? null,
        contract_length_months: r.contract_length_months ?? null,
        min_order_volume: r.min_order_volume ?? null,
        min_order_unit: r.min_order_unit ?? null,
        payment_terms: r.payment_terms ?? null,
        delivery_terms: r.delivery_terms ?? null,
        datasheet_url: r.datasheet_url ?? null,
        notes: r.notes ?? null,
        status,
        submitted_at: submittedAt,
      };
      const { error: upErr } = await admin
        .from("negotiation_responses")
        .upsert(payload as any, { onConflict: "recipient_id,negotiation_item_id" });
      if (upErr) throw upErr;
    }

    if (finalize) {
      await admin
        .from("negotiation_recipients")
        .update({ status: "responded", responded_at: new Date().toISOString() })
        .eq("id", row.recipient_id);
      // Move negotiation to in_progress if currently invited
      await admin
        .from("negotiations")
        .update({ status: "in_progress" })
        .eq("id", row.negotiation_id)
        .eq("status", "invited");
    }

    await admin.from("negotiation_messages").insert({
      negotiation_id: row.negotiation_id,
      recipient_id: row.recipient_id,
      event_type: finalize ? "response_submitted" : "response_draft_saved",
      actor: "supplier",
    } as any);

    return new Response(JSON.stringify({ success: true, finalized: !!finalize }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("submit-negotiation-response", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
