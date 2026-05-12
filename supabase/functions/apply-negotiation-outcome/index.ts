import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: cErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (cErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    const { negotiation_id, outcomes } = body ?? {};
    if (!negotiation_id || !Array.isArray(outcomes)) {
      return new Response(JSON.stringify({ error: "invalid_payload" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Verify caller has write access via the user-scoped client (RLS)
    const { data: neg, error: negErr } = await supabase
      .from("negotiations")
      .select("id, legal_entity_id")
      .eq("id", negotiation_id)
      .maybeSingle();
    if (negErr || !neg) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    for (const o of outcomes) {
      // Persist outcome
      await admin.from("negotiation_outcomes").upsert({
        negotiation_id,
        negotiation_item_id: o.negotiation_item_id,
        winner_recipient_id: o.winner_recipient_id ?? null,
        winner_response_id: o.winner_response_id ?? null,
        agreed_price: o.agreed_price ?? null,
        agreed_package_size: o.agreed_package_size ?? null,
        agreed_package_unit: o.agreed_package_unit ?? null,
        set_as_primary: !!o.set_as_primary,
        applied_to_supplier: !!o.apply_to_supplier,
        notes: o.notes ?? null,
      } as any, { onConflict: "negotiation_id,negotiation_item_id" });

      if (o.apply_to_supplier && o.winner_recipient_id) {
        // Look up supplier_id + raw_material_id
        const { data: rec } = await admin
          .from("negotiation_recipients")
          .select("supplier_id")
          .eq("id", o.winner_recipient_id)
          .maybeSingle();
        const { data: item } = await admin
          .from("negotiation_items")
          .select("raw_material_id")
          .eq("id", o.negotiation_item_id)
          .maybeSingle();
        if (rec?.supplier_id && item?.raw_material_id) {
          await admin.from("raw_material_suppliers").upsert({
            raw_material_id: item.raw_material_id,
            supplier_id: rec.supplier_id,
            agreed_price: o.agreed_price ?? null,
            package_size: o.agreed_package_size ?? null,
            package_unit: o.agreed_package_unit ?? null,
            agreement_valid_from: new Date().toISOString().slice(0, 10),
            is_primary: !!o.set_as_primary,
          } as any, { onConflict: "raw_material_id,supplier_id" });

          if (o.set_as_primary) {
            await admin.from("raw_materials")
              .update({ primary_supplier_id: rec.supplier_id })
              .eq("id", item.raw_material_id);
          }
        }
      }
    }

    // Conclude negotiation + expire all tokens
    await admin.from("negotiations")
      .update({ status: "concluded", concluded_at: new Date().toISOString() })
      .eq("id", negotiation_id);
    await admin.from("negotiation_recipients")
      .update({ status: "expired", expires_at: new Date().toISOString() })
      .eq("negotiation_id", negotiation_id);

    await admin.from("negotiation_messages").insert({
      negotiation_id,
      event_type: "concluded",
      actor: "nbhub",
      payload: { count: outcomes.length },
    } as any);

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("apply-negotiation-outcome", e);
    console.error("apply-negotiation-outcome", e);
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
