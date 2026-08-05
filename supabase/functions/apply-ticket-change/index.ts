// Trygt anvende AI-foreslåtte endringer (eller kansellering) fra en ticket på en ordre.
// Krever ordre-skrivetilgang. Skriver kun whitelistede felt.
// Logger til audit_log + legger en linje på tickets.internal_notes.

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonErr(msg: string, status: number, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error: msg, ...extra }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ALLOWED_FIELDS = new Set([
  "delivery_date",
  "delivery_time",
  "customer_notes",
  "internal_notes",
  "delivery_address_line1",
  "delivery_address_line2",
  "delivery_postal_code",
  "delivery_city",
]);

const LineChangeSchema = z.object({
  order_line_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  new_quantity: z.number().positive().optional(),
  add: z.boolean().optional(),
});

const InputSchema = z.object({
  ticket_id: z.string().uuid(),
  order_id: z.string().uuid(),
  action: z.enum(["apply_changes", "cancel_order"]),
  changes: z.array(z.object({
    field: z.string(),
    new_value: z.string().nullable(),
  })).default([]),
  line_changes: z.array(LineChangeSchema).default([]),
  cancellation_reason: z.string().nullable().optional(),
  mark_resolved: z.boolean().optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return jsonErr("Missing Authorization", 401);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return jsonErr("Not authenticated", 401);
    const userId = userRes.user.id;

    const { data: hasWrite } = await userClient.rpc("has_app_write_access", { p_app_code: "ordre" });
    if (!hasWrite) return jsonErr("Forbidden — mangler skrivetilgang på ordre", 403);

    const parsed = InputSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return jsonErr("Ugyldig input", 400, { details: parsed.error.flatten() });
    const { ticket_id, order_id, action, changes, line_changes, cancellation_reason, mark_resolved } = parsed.data;

    const { data: ticket } = await admin.from("tickets")
      .select("id,subject,internal_notes,related_order_id,ai_suggestion")
      .eq("id", ticket_id).maybeSingle();
    if (!ticket) return jsonErr("Ticket ikke funnet", 404);

    // (b) order_id må være en bekreftet ticket↔ordre-kobling — ikke vilkårlig id.
    let linked = ticket.related_order_id === order_id;
    if (!linked) {
      const { data: link } = await admin.from("ticket_order_links")
        .select("order_id").eq("ticket_id", ticket_id).eq("order_id", order_id).maybeSingle();
      linked = !!link;
    }
    if (!linked) return jsonErr("Ordren er ikke koblet til denne saken", 403);

    const { data: order } = await admin.from("orders")
      .select("id,order_number,status,customer_id,delivery_date,delivery_time,customer_notes,internal_notes,delivery_address_line1,delivery_address_line2,delivery_postal_code,delivery_city,legal_entity_id")
      .eq("id", order_id).maybeSingle();
    if (!order) return jsonErr("Ordre ikke funnet", 404);

    // (a) Låste ordrestatuser kan ikke endres fra ticket-flyten.
    const LOCKED = new Set(["delivered", "invoiced", "cancelled"]);
    if (LOCKED.has(String(order.status))) {
      return jsonErr(`Ordren har status "${order.status}" og kan ikke endres`, 409);
    }

    // (d) AI-genererte UUID-er må finnes i sakens egne kandidatlister.
    const ai = (ticket.ai_suggestion ?? {}) as Record<string, any>;
    const allowedProductIds = new Set<string>(
      [
        ...(Array.isArray(ai.products) ? ai.products : []),
        ...(Array.isArray(ai.change_intent?.line_changes) ? ai.change_intent.line_changes : []),
      ]
        .map((p: any) => p?.product_id)
        .filter((x: unknown): x is string => typeof x === "string"),
    );

    const nowISO = new Date().toISOString();
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (action === "cancel_order") {
      if (order.status === "cancelled") {
        return jsonErr("Ordren er allerede kansellert", 409);
      }
      before.status = order.status;
      after.status = "cancelled";
      const patch: Record<string, unknown> = {
        status: "cancelled",
        status_changed_at: nowISO,
        status_changed_by: userId,
        cancelled_at: nowISO,
        cancelled_by: userId,
        cancelled_reason: cancellation_reason ?? `Kansellert via ticket "${ticket.subject ?? ticket.id}"`,
      };
      const { error: uErr } = await admin.from("orders").update(patch).eq("id", order_id);
      if (uErr) return jsonErr(`Kunne ikke kansellere ordre: ${uErr.message}`, 500);
    } else {
      // apply_changes
      const patch: Record<string, unknown> = {};
      for (const c of changes) {
        if (!ALLOWED_FIELDS.has(c.field)) continue;
        before[c.field] = (order as any)[c.field] ?? null;
        // Normaliser tomme strenger til null
        const v = c.new_value === "" ? null : c.new_value;
        patch[c.field] = v;
        after[c.field] = v;
      }
      if (Object.keys(patch).length > 0) {
        const { error: uErr } = await admin.from("orders").update(patch).eq("id", order_id);
        if (uErr) return jsonErr(`Kunne ikke oppdatere ordre: ${uErr.message}`, 500);
      }

      // Ordrelinje-endringer
      const lineChangesLog: Array<Record<string, unknown>> = [];
      for (const lc of line_changes) {
        if (lc.add) {
          if (!lc.product_id || !lc.new_quantity) {
            return jsonErr("add=true krever product_id og new_quantity", 400);
          }
          if (!allowedProductIds.has(lc.product_id)) {
            return jsonErr("Produktet finnes ikke i sakens AI-forslag", 400);
          }
          const { data: prod, error: pErr } = await admin
            .from("products")
            .select("id, display_name, unit_of_sale, mva_rate")
            .eq("id", lc.product_id)
            .maybeSingle();
          if (pErr || !prod) return jsonErr(`Produkt ikke funnet: ${lc.product_id}`, 404);
          const { data: maxRow } = await admin
            .from("order_lines")
            .select("line_number")
            .eq("order_id", order_id)
            .order("line_number", { ascending: false })
            .limit(1)
            .maybeSingle();
          const nextLineNo = ((maxRow?.line_number as number | undefined) ?? 0) + 1;
          const vatRate = Number((prod as any).mva_rate ?? 0);
          // (c) Pris må hentes fra kundens prisgrunnlag — aldri 0 uten grunnlag.
          const { data: priceRow, error: prErr } = await admin.rpc("get_customer_unit_price", {
            p_customer_id: order.customer_id,
            p_product_id: prod.id,
            p_date: (order as any).delivery_date ?? new Date().toISOString().slice(0, 10),
            p_caller: "apply-ticket-change",
          });
          const unitPrice = Number(priceRow ?? 0);
          if (prErr || !(unitPrice > 0)) {
            return jsonErr(`Fant ingen gyldig pris for produktet "${(prod as any).display_name}" — legg til linjen manuelt`, 409);
          }
          const addSubtotal = unitPrice * lc.new_quantity;
          const { error: iErr } = await admin.from("order_lines").insert({
            order_id,
            line_number: nextLineNo,
            product_id: prod.id,
            product_snapshot: { name: (prod as any).display_name } as never,
            quantity: lc.new_quantity,
            sales_unit: (prod as any).unit_of_sale ?? "stk",
            unit_price: unitPrice,
            unit_price_source: "price_list",
            line_subtotal_excl_vat: addSubtotal,
            vat_rate: vatRate,
            line_vat: addSubtotal * (vatRate / 100),
            line_total_incl_vat: addSubtotal * (1 + vatRate / 100),
            notes: "Lagt til via ticket",
          } as never);
          if (iErr) return jsonErr(`Kunne ikke legge til linje: ${iErr.message}`, 500);
          lineChangesLog.push({ op: "add", product_id: prod.id, product_name: (prod as any).display_name, quantity: lc.new_quantity, unit_price: unitPrice });
        } else {
          if (!lc.order_line_id || lc.new_quantity == null) {
            return jsonErr("Endring krever order_line_id og new_quantity", 400);
          }
          const { data: existing, error: gErr } = await admin
            .from("order_lines")
            .select("id, order_id, quantity, unit_price, vat_rate")
            .eq("id", lc.order_line_id)
            .maybeSingle();
          if (gErr || !existing) return jsonErr("Ordrelinje ikke funnet", 404);
          if (existing.order_id !== order_id) return jsonErr("Ordrelinje tilhører annen ordre", 400);
          const unitPrice = Number(existing.unit_price ?? 0);
          const vatRate = Number(existing.vat_rate ?? 0);
          const subtotal = unitPrice * lc.new_quantity;
          const { error: uErr } = await admin
            .from("order_lines")
            .update({
              quantity: lc.new_quantity,
              line_subtotal_excl_vat: subtotal,
              line_vat: subtotal * (vatRate / 100),
              line_total_incl_vat: subtotal * (1 + vatRate / 100),
            })
            .eq("id", lc.order_line_id);
          if (uErr) return jsonErr(`Kunne ikke oppdatere linje: ${uErr.message}`, 500);
          lineChangesLog.push({
            op: "update_qty",
            order_line_id: lc.order_line_id,
            before_qty: Number(existing.quantity),
            new_qty: lc.new_quantity,
          });
        }
      }
      if (lineChangesLog.length > 0) {
        (after as any).line_changes = lineChangesLog;
      }
      if (Object.keys(patch).length === 0 && lineChangesLog.length === 0) {
        return jsonErr("Ingen gyldige endringer å lagre", 400);
      }
    }

    // Koble ticket til ordre hvis ikke allerede koblet
    const ticketPatch: Record<string, unknown> = {};
    if (!ticket.related_order_id) ticketPatch.related_order_id = order_id;
    if (mark_resolved) ticketPatch.status = "resolved";
    // Append en linje til internal_notes
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const actionLabel = action === "cancel_order" ? "Kansellert ordre" : `Anvendte endringer: ${Object.keys(after).join(", ")}`;
    const noteLine = `[${stamp}] ${actionLabel} på ordre ${order.order_number ?? order_id}`;
    ticketPatch.internal_notes = ticket.internal_notes ? `${ticket.internal_notes}\n${noteLine}` : noteLine;
    await admin.from("tickets").update(ticketPatch).eq("id", ticket_id);

    // Audit
    await admin.from("audit_log").insert({
      user_id: userId,
      user_display_name: userRes.user.email ?? null,
      action: action === "cancel_order" ? "order.cancelled_from_ticket" : "order.updated_from_ticket",
      entity_type: "order",
      entity_id: order_id,
      entity_display_reference: order.order_number ?? null,
      legal_entity_id: order.legal_entity_id ?? null,
      changes: { before, after, ticket_id, cancellation_reason: cancellation_reason ?? null } as never,
      reason: `Anvendt fra ticket ${ticket.subject ?? ticket_id}`,
      source_app: "ordre",
    });

    // Tidslinje-hendelser
    const tEvents: Record<string, unknown>[] = [];
    if (!ticket.related_order_id) {
      tEvents.push({
        ticket_id, order_id,
        event_type: "ticket.linked_to_order",
        actor_type: "staff",
        actor_user_id: userId,
        actor_label: userRes.user.email ?? null,
        summary: order.order_number ?? null,
        payload: {},
      });
    }
    tEvents.push({
      ticket_id, order_id,
      event_type: action === "cancel_order" ? "order.cancelled" : "order.fields_changed",
      actor_type: "staff",
      actor_user_id: userId,
      actor_label: userRes.user.email ?? null,
      summary: action === "cancel_order"
        ? (cancellation_reason ?? `Ordre ${order.order_number ?? ""} kansellert`)
        : `Endret felt: ${Object.keys(after).join(", ")}`,
      payload: { before, after, cancellation_reason: cancellation_reason ?? null },
    });
    if (mark_resolved) {
      tEvents.push({
        ticket_id, order_id,
        event_type: "ticket.resolved",
        actor_type: "staff",
        actor_user_id: userId,
        actor_label: userRes.user.email ?? null,
        summary: "Lukket etter anvendt endring",
        payload: {},
      });
    }
    await admin.from("ticket_events").insert(tEvents);

    return new Response(JSON.stringify({ ok: true, order_id, applied: Object.keys(after) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("apply-ticket-change error", e);
    return jsonErr((e as Error).message ?? "error", 500);
  }
});
