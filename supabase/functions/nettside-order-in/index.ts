// Nettside-ordre inn: tar imot ordre fra nettbutikken, lagrer i website_orders
// og forsøker automatisk konvertering til en ordre som venter på godkjenning.
// POST /nettside-order-in
//
// Payload-kontrakt (nøstet form fra nettsiden):
// {
//   site_order_id: uuid,
//   order_number: string,
//   customer: { name, email, phone, is_business, business_name, business_org_no },
//   pickup:   { date, location_name, window_start, window_end, nbhub_customer_id },
//   payment:  { method, status },
//   totals:   { net, mva, gross },
//   lines:    [...],
//   note:     string
// }
// Flat form (site_order_number, customer_name, pickup_date, total_net ...) leses
// fortsatt som reserve for eldre integrasjoner.
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

const str = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.trim().replace(/\s/g, "").replace(",", ".");
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

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

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  async function logReject(
    code: string,
    reason: string,
    httpStatus: number,
    rawBody: string | null,
    rawPayload: unknown,
  ) {
    try {
      const { error } = await admin.from("website_order_rejects").insert({
        code,
        reason,
        http_status: httpStatus,
        raw_body: rawBody,
        raw_payload: rawPayload ?? null,
      });
      if (error) console.error("nettside-order-in: kunne ikke logge avvisning", error.message);
    } catch (e) {
      console.error(
        "nettside-order-in: kunne ikke logge avvisning",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  let rawBody = "";
  let payload: Record<string, unknown>;
  try {
    rawBody = await req.text();
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    await logReject("invalid_json", "Kroppen kunne ikke parses som JSON", 400, rawBody, null);
    return jsonRes({ error: "Ugyldig JSON", code: "invalid_json" }, 400);
  }

  const customer = obj(payload.customer);
  const pickup = obj(payload.pickup);
  const payment = obj(payload.payment);
  const totals = obj(payload.totals);

  const siteOrderId = payload.site_order_id ?? payload.siteOrderId ?? payload.order_id;
  const siteOrderNumber =
    str(payload.order_number) ?? str(payload.site_order_number) ?? str(payload.orderNumber);

  if (!isUuid(siteOrderId) || !siteOrderNumber) {
    await logReject(
      "invalid_payload",
      "site_order_id (uuid) og ordrenummer kreves",
      400,
      rawBody,
      payload,
    );
    return jsonRes(
      { error: "site_order_id (uuid) og order_number kreves", code: "invalid_payload" },
      400,
    );
  }

  const lines = Array.isArray(payload.lines) ? payload.lines : [];

  const pickupCustomerId = pickup.nbhub_customer_id ?? payload.pickup_nbhub_customer_id;
  const isBusiness =
    customer.is_business === true ||
    payload.is_business_order === true ||
    customer.is_business_order === true;

  const row = {
    site_order_id: siteOrderId,
    site_order_number: siteOrderNumber,
    status: "received",
    customer_name: str(customer.name) ?? str(payload.customer_name),
    customer_email: str(customer.email) ?? str(payload.customer_email),
    customer_phone: str(customer.phone) ?? str(payload.customer_phone),
    is_business_order: isBusiness,
    business_name: str(customer.business_name) ?? str(payload.business_name),
    business_org_no: str(customer.business_org_no) ?? str(payload.business_org_no),
    pickup_location_name: str(pickup.location_name) ?? str(payload.pickup_location_name),
    pickup_nbhub_customer_id: isUuid(pickupCustomerId) ? pickupCustomerId : null,
    pickup_date: str(pickup.date) ?? str(payload.pickup_date),
    pickup_window_start: str(pickup.window_start) ?? str(payload.pickup_window_start),
    pickup_window_end: str(pickup.window_end) ?? str(payload.pickup_window_end),
    payment_method: str(payment.method) ?? str(payload.payment_method),
    payment_status: str(payment.status) ?? str(payload.payment_status),
    total_net: num(totals.net) ?? num(payload.total_net),
    total_mva: num(totals.mva) ?? num(payload.total_mva),
    total_gross: num(totals.gross) ?? num(payload.total_gross),
    customer_note: str(payload.note) ?? str(payload.customer_note),
    lines,
    raw_payload: payload,
  };

  let websiteOrderId: string | null = null;
  let duplicate = false;

  const { data: inserted, error: insertErr } = await admin
    .from("website_orders")
    .insert(row)
    .select("id")
    .single();

  if (insertErr) {
    if ((insertErr as { code?: string }).code === "23505") {
      const { data: existing } = await admin
        .from("website_orders")
        .select("id")
        .eq("site_order_id", siteOrderId)
        .maybeSingle();
      if (existing?.id) {
        return jsonRes({
          ok: true,
          website_order_id: existing.id,
          duplicate: true,
          converted: false,
          convert_error: null,
        }, 200);
      }
    }
    console.error("nettside-order-in: insert feilet", insertErr.message);
    await logReject("insert_failed", insertErr.message, 500, rawBody, payload);
    return jsonRes(
      { error: insertErr.message ?? "Kunne ikke lagre ordren", code: "insert_failed" },
      500,
    );
  }

  websiteOrderId = inserted!.id;

  // Auto-ingest: forsøk konvertering til ordre som venter på godkjenning.
  // Feiler den (ukjent vare, manglende kunde o.l.) blir nettside-ordren
  // liggende i website_orders som fallback-kø på Nettbutikk-siden.
  let converted = false;
  let convertError: string | null = null;
  try {
    const { error: convErr } = await admin.rpc("convert_website_order", {
      p_website_order_id: websiteOrderId,
      p_initial_status: "awaiting_confirmation",
    });
    if (convErr) {
      convertError = convErr.message;
      console.error("nettside-order-in: auto-konvertering feilet", websiteOrderId, convErr.message);
    } else {
      converted = true;
    }
  } catch (e) {
    convertError = e instanceof Error ? e.message : String(e);
    console.error("nettside-order-in: auto-konvertering kastet", websiteOrderId, convertError);
  }

  return jsonRes(
    { ok: true, website_order_id: websiteOrderId, duplicate, converted, convert_error: convertError },
    201,
  );
});
