// AI-forslag for hva ordrekontoret bør gjøre med en ordre.
// Bruker Lovable AI Gateway (samme mønster som suggest-raw-material-allergens).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `Du er en assistent for et norsk bakeris ordrekontor (Nøtterø Bakeri).
For en gitt ordre skal du foreslå NESTE BESTE HANDLING for saksbehandleren.

Mulige handlinger (kanoniske koder):
- "confirm_order"        → Ordren ser komplett ut og kan bekreftes nå.
- "contact_customer"     → Mangler info eller har uklarhet, ring/skriv til kunden.
- "release_hold"         → På vent uten åpenbar grunn, frigi.
- "keep_on_hold"         → Riktig at den står på vent (mangler bet., kreditt-stopp e.l.).
- "delete_draft"         → Utkast er gammelt og bør slettes.
- "complete_draft"       → Utkast har innhold og bør fullføres.
- "review_lines"         → Linjer ser rare ut (manglende pris, 0 antall e.l.) — vurder.
- "no_action"            → Ingen handling nødvendig akkurat nå.

Returner ALLTID via tool-kallet "suggest" med:
- action          : kanonisk kode
- confidence      : 0..1, hvor sikker du er
- reason          : 1-2 setninger på norsk, konkret, refererer til feltene du så på.
- draft_message?  : Hvis action="contact_customer", et kort utkast (norsk, vennlig, < 60 ord).
Vær konsis og handlingsorientert. Ikke gjenta åpenbare data.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { order_id } = await req.json();
    if (!order_id) return json({ error: "order_id required" }, 400);

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes.user) return json({ error: "Unauthorized" }, 401);

    const service = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Hent ordre + linjer
    const { data: order, error: oErr } = await service
      .from("orders")
      .select(
        "id, order_number, status, source, customer_id, customer_snapshot, delivery_date, delivery_time, total_incl_vat, internal_notes, customer_notes, ordered_at, status_changed_at, previous_status_before_hold, delivery_address_line1, delivery_postal_code, delivery_city",
      )
      .eq("id", order_id)
      .maybeSingle();
    if (oErr || !order) return json({ error: "Order not found" }, 404);

    const { data: lines } = await service
      .from("order_lines")
      .select("line_number, quantity, sales_unit, unit_price, line_total_incl_vat, product_snapshot")
      .eq("order_id", order_id)
      .order("line_number", { ascending: true })
      .limit(50);

    const customerName =
      (order.customer_snapshot as Record<string, unknown> | null)?.["display_name"] ?? "(ukjent)";

    const linesText =
      (lines ?? [])
        .map(
          (l) =>
            `  ${l.line_number}. ${
              ((l.product_snapshot as Record<string, unknown> | null)?.["display_name"] as string) ?? "?"
            } — ${l.quantity} ${l.sales_unit} à kr ${Number(l.unit_price ?? 0).toFixed(2)} = kr ${Number(l.line_total_incl_vat ?? 0).toFixed(2)}`,
        )
        .join("\n") || "  (ingen linjer)";

    const userMsg = `Ordre ${order.order_number}
Status: ${order.status}${order.previous_status_before_hold ? ` (tidligere: ${order.previous_status_before_hold})` : ""}
Kilde: ${order.source}
Kunde: ${customerName}
Levering: ${order.delivery_date}${order.delivery_time ? " kl " + order.delivery_time : ""}
Adresse: ${[order.delivery_address_line1, order.delivery_postal_code, order.delivery_city].filter(Boolean).join(", ") || "(ikke satt)"}
Total: kr ${Number(order.total_incl_vat ?? 0).toFixed(2)}
Antall linjer: ${(lines ?? []).length}
Bestilt: ${order.ordered_at}
Status endret: ${order.status_changed_at}
Internnotat: ${order.internal_notes ?? "(ingen)"}
Kundemerknad: ${order.customer_notes ?? "(ingen)"}

Linjer:
${linesText}`;

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY missing" }, 500);

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMsg },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "suggest",
              parameters: {
                type: "object",
                properties: {
                  action: {
                    type: "string",
                    enum: [
                      "confirm_order",
                      "contact_customer",
                      "release_hold",
                      "keep_on_hold",
                      "delete_draft",
                      "complete_draft",
                      "review_lines",
                      "no_action",
                    ],
                  },
                  confidence: { type: "number" },
                  reason: { type: "string" },
                  draft_message: { type: "string" },
                },
                required: ["action", "confidence", "reason"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "suggest" } },
      }),
    });

    if (aiResp.status === 429) return json({ error: "Rate limit, prøv igjen om litt." }, 429);
    if (aiResp.status === 402) return json({ error: "AI-kreditt brukt opp." }, 402);
    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      return json({ error: "AI gateway error" }, 502);
    }

    const aiData = await aiResp.json();
    const tc = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc) return json({ error: "No suggestion returned" }, 502);
    const args = JSON.parse(tc.function.arguments);

    // Logg
    try {
      const { data: pos } = await service
        .from("user_positions")
        .select("legal_entity_id")
        .eq("user_id", userRes.user.id)
        .limit(1)
        .maybeSingle();
      await service.from("ai_usage_log").insert({
        provider: "lovable",
        model: "google/gemini-3-flash-preview",
        purpose: "ordre_action_suggest",
        input_tokens: aiData.usage?.prompt_tokens ?? 0,
        output_tokens: aiData.usage?.completion_tokens ?? 0,
        legal_entity_id: pos?.legal_entity_id ?? null,
        success: true,
      });
    } catch (_e) {
      /* logging er best-effort */
    }

    return json({
      action: args.action,
      confidence: args.confidence,
      reason: args.reason,
      draft_message: args.draft_message ?? null,
      generated_at: new Date().toISOString(),
    });
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
