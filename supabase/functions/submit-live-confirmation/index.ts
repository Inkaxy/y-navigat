import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ItemConfirmation {
  negotiation_item_id: string;
  confirmed: boolean;
  supplier_note?: string | null;
  datasheet_path?: string | null;
  datasheet_skipped?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token ?? "");
    const password = String(body?.password ?? "");
    const items = (body?.items ?? []) as ItemConfirmation[];
    const paymentTermsDays = body?.payment_terms_days ?? null;

    if (!token || !password || !Array.isArray(items)) {
      return new Response(JSON.stringify({ error: "invalid_payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await admin.rpc("negotiation_recipient_by_token", {
      p_token: token,
      p_password: password,
    });
    if (error) throw error;
    const row = (data ?? [])[0];
    if (!row || row.result !== "ok") {
      return new Response(JSON.stringify({ result: row?.result ?? "invalid_token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const negotiationId = row.negotiation_id;

    // Validate ownership of items
    const itemIds = items.map((i) => i.negotiation_item_id);
    const { data: dbItems } = await admin
      .from("negotiation_items")
      .select("id, negotiation_id, live_status")
      .in("id", itemIds);
    for (const it of dbItems ?? []) {
      if (it.negotiation_id !== negotiationId) {
        return new Response(JSON.stringify({ error: "item_mismatch" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const now = new Date().toISOString();

    for (const it of items) {
      if (it.confirmed) {
        const hasDs = !!it.datasheet_path || it.datasheet_skipped === true;
        if (!hasDs) continue; // skip; client should validate, but be defensive
        await admin
          .from("negotiation_items")
          .update({
            live_status: "confirmed",
            live_confirmed_at: now,
            live_confirmed_by_supplier: true,
            live_supplier_note: it.supplier_note ?? null,
            live_datasheet_path: it.datasheet_path ?? null,
            live_datasheet_skipped: !!it.datasheet_skipped,
            live_agreed_payment_terms_days:
              paymentTermsDays != null ? Number(paymentTermsDays) : undefined,
          } as any)
          .eq("id", it.negotiation_item_id);
        await admin.from("negotiation_live_events").insert({
          negotiation_id: negotiationId,
          negotiation_item_id: it.negotiation_item_id,
          event_type: "confirmation_submitted",
          event_data: { confirmed: true, datasheet_skipped: !!it.datasheet_skipped },
        } as any);
      } else if (it.supplier_note) {
        // Disputed: keep tentatively_agreed, save note
        await admin
          .from("negotiation_items")
          .update({
            live_supplier_note: it.supplier_note,
            live_confirmed_by_supplier: false,
          } as any)
          .eq("id", it.negotiation_item_id);
        await admin.from("negotiation_live_events").insert({
          negotiation_id: negotiationId,
          negotiation_item_id: it.negotiation_item_id,
          event_type: "confirmation_disputed",
          note: it.supplier_note,
        } as any);
      }
    }

    // If all tentatively_agreed items in this negotiation are now confirmed,
    // mark negotiation as concluded.
    const { data: pending } = await admin
      .from("negotiation_items")
      .select("id")
      .eq("negotiation_id", negotiationId)
      .in("live_status", ["tentatively_agreed"]);
    const allDone = (pending?.length ?? 0) === 0;
    if (allDone) {
      // Check auto-apply flag
      const { data: negRow } = await admin
        .from("negotiations")
        .select("live_auto_apply_on_confirm")
        .eq("id", negotiationId)
        .maybeSingle();

      await admin
        .from("negotiations")
        .update({ status: "concluded", concluded_at: now } as any)
        .eq("id", negotiationId);
      await admin.from("negotiation_live_events").insert({
        negotiation_id: negotiationId,
        event_type: "all_confirmed",
      } as any);

      if (negRow?.live_auto_apply_on_confirm) {
        // Build outcomes from confirmed items
        const { data: confItems } = await admin
          .from("negotiation_items")
          .select(
            "id, raw_material_id, live_agreed_price, live_agreed_package_size, live_agreed_package_unit, live_agreed_price_per_base_unit",
          )
          .eq("negotiation_id", negotiationId)
          .eq("live_status", "confirmed");
        const { data: rec } = await admin
          .from("negotiation_recipients")
          .select("id")
          .eq("negotiation_id", negotiationId)
          .limit(1)
          .maybeSingle();
        const outcomes = (confItems ?? []).map((it: any) => ({
          negotiation_item_id: it.id,
          winner_recipient_id: rec?.id ?? null,
          winner_response_id: null,
          agreed_price: it.live_agreed_price_per_base_unit ?? it.live_agreed_price,
          agreed_package_size: it.live_agreed_package_size,
          agreed_package_unit: it.live_agreed_package_unit,
          set_as_primary: false,
          apply_to_supplier: true,
        }));
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          await fetch(`${supabaseUrl}/functions/v1/apply-negotiation-outcome`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
            },
            body: JSON.stringify({ negotiation_id: negotiationId, outcomes }),
          });
        } catch (e) {
          console.error("auto-apply failed", e);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, all_confirmed: allDone }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("submit-live-confirmation", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
