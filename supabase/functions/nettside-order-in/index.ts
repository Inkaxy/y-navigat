// Nettside-ordre inn: tar imot ordre fra nettbutikken, lagrer i website_orders
// og forsøker automatisk konvertering til en ordre som venter på godkjenning.
// POST /nettside-order-in
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-nettside-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

const isUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonRes({ error: "Bruk POST", code: "method_not_allowed" }, 405);
  }

  // Delt nøkkel — kun håndhevet hvis den er konfigurert.
  const expectedKey = Deno.env.get("NETTSIDE_API_KEY");
  if (expectedKey) {
    const provided =
      req.headers.get("x-nettside-key") ??
      (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (provided !== expectedKey) {
      return jsonRes({ error: "Ugyldig nøkkel", code: "unauthorized" }, 401);
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonRes({ error: "Ugyldig JSON", code: "invalid_json" }, 400);
  }

  const siteOrderId = payload.site_order_id;
  const siteOrderNumber = str(payload.site_order_number);
  if (!isUuid(siteOrderId) || !siteOrderNumber) {
    return jsonRes(
      { error: "site_order_id (uuid) og site_order_number kreves", code: "invalid_payload" },
      400,
    );
  }

  const lines = Array.isArray(payload.lines) ? payload.lines : [];

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const row = {
    site_order_id: siteOrderId,
    site_order_number: siteOrderNumber,
    status: "received",
    customer_name: str(payload.customer_name),
    customer_email: str(payload.customer_email),
    customer_phone: str(payload.customer_phone),
    is_business_order: payload.is_business_order === true,
    business_name: str(payload.business_name),
    business_org_no: str(payload.business_org_no),
    pickup_location_name: str(payload.pickup_location_name),
    pickup_nbhub_customer_id: isUuid(payload.pickup_nbhub_customer_id)
      ? payload.pickup_nbhub_customer_id
      : null,
    pickup_date: str(payload.pickup_date),
    pickup_window_start: str(payload.pickup_window_start),
    pickup_window_end: str(payload.pickup_window_end),
    payment_method: str(payload.payment_method),
    payment_status: str(payload.payment_status),
    total_net: num(payload.total_net),
    total_mva: num(payload.total_mva),
    total_gross: num(payload.total_gross),
    customer_note: str(payload.customer_note),
    lines,
    raw_payload: payload,
  };

  const { data: inserted, error: insertErr } = await admin
    .from("website_orders")
    .insert(row)
    .select("id")
    .single();

  if (insertErr || !inserted) {
    console.error("nettside-order-in: insert feilet", insertErr?.message);
    return jsonRes(
      { error: insertErr?.message ?? "Kunne ikke lagre ordren", code: "insert_failed" },
      500,
    );
  }

  // Auto-ingest: forsøk konvertering til ordre som venter på godkjenning.
  // Feiler den (ukjent vare, manglende kunde o.l.) blir nettside-ordren
  // liggende i website_orders som fallback-kø på Nettbutikk-siden.
  try {
    const { error: convErr } = await admin.rpc("convert_website_order", {
      p_website_order_id: inserted.id,
      p_initial_status: "awaiting_confirmation",
    });
    if (convErr) {
      console.error(
        "nettside-order-in: auto-konvertering feilet",
        inserted.id,
        convErr.message,
      );
    }
  } catch (e) {
    console.error(
      "nettside-order-in: auto-konvertering kastet",
      inserted.id,
      e instanceof Error ? e.message : String(e),
    );
  }

  return jsonRes({ ok: true, website_order_id: inserted.id }, 201);
});
