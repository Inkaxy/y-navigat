// Pakkesystem-API — REST-endepunkter for pakkesystem-leverandøren.
// Bearer-auth med langlevd API-nøkkel per legal_entity.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function err(status: number, code: string, error: string) {
  return jsonResponse({ error, code }, status);
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function authenticate(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return { error: err(401, "missing_bearer", "Authorization: Bearer <token> mangler") };
  const token = m[1].trim();
  const hash = await sha256Hex(token);
  const { data, error } = await admin
    .from("pakkesystem_api_keys")
    .select("id, legal_entity_id, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();
  if (error || !data || data.revoked_at) {
    return { error: err(401, "invalid_key", "Ugyldig eller tilbaketrukket API-nøkkel") };
  }
  return { key: data as { id: string; legal_entity_id: string } };
}

async function checkRateLimit(apiKeyId: string) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin
    .from("pakkesystem_api_log")
    .select("id", { count: "exact", head: true })
    .eq("api_key_id", apiKeyId)
    .gte("created_at", since);
  if ((count ?? 0) >= 60) return err(429, "rate_limited", "Maks 60 requests per minutt");
  return null;
}

async function logAndReturn(params: {
  apiKeyId: string;
  legalEntityId: string;
  endpoint: string;
  queryParams: Record<string, string>;
  statusCode: number;
  rowCount: number | null;
  req: Request;
  response: Response;
}) {
  const { apiKeyId, legalEntityId, endpoint, queryParams, statusCode, rowCount, req } = params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent") ?? null;
  await admin.from("pakkesystem_api_log").insert({
    api_key_id: apiKeyId,
    legal_entity_id: legalEntityId,
    endpoint,
    query_params: queryParams,
    status_code: statusCode,
    row_count: rowCount,
    ip,
    ua,
  });
  await admin
    .from("pakkesystem_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKeyId);
  return params.response;
}

// ---------- Datamappere ----------

async function fetchProducts(legalEntityId: string) {
  const { data, error } = await admin
    .from("products")
    .select(
      "id, display_number, display_name, status, is_for_sale, pieces_per_tray, main_category_id, product_main_categories(display_name)",
    )
    .eq("legal_entity_id", legalEntityId)
    .eq("is_for_sale", true)
    .neq("status", "discontinued")
    .order("display_number");
  if (error) throw error;
  return (data ?? []).map((p: any) => ({
    id: p.id,
    product_number: String(p.display_number ?? ""),
    name: p.display_name,
    category: p.product_main_categories?.display_name ?? null,
    pieces_per_tray: p.pieces_per_tray ?? null,
    ean: null,
    unit_price: null,
    active: p.status === "active",
  }));
}

async function fetchCustomers(legalEntityId: string) {
  const { data, error } = await admin
    .from("customers")
    .select(
      "id, customer_number, display_name, delivery_address_line1, delivery_postal_code, delivery_city, primary_contact_phone, primary_contact_email, delivery_instructions, status",
    )
    .eq("legal_entity_id", legalEntityId)
    .eq("status", "active")
    .order("customer_number");
  if (error) throw error;
  return (data ?? []).map((c: any) => ({
    id: c.id,
    customer_number: c.customer_number,
    name: c.display_name,
    address: {
      street: c.delivery_address_line1 ?? null,
      postal_code: c.delivery_postal_code ?? null,
      city: c.delivery_city ?? null,
    },
    phone: c.primary_contact_phone ?? null,
    email: c.primary_contact_email ?? null,
    delivery_route: null,
    delivery_sequence: null,
    notes: c.delivery_instructions ?? null,
  }));
}

const STATUS_MAP: Record<string, "draft" | "confirmed" | "cancelled"> = {
  draft: "draft",
  awaiting_confirmation: "draft",
  on_hold: "draft",
  confirmed: "confirmed",
  in_production: "confirmed",
  packed: "confirmed",
  partial_delivery: "confirmed",
  delivered: "confirmed",
  invoiced: "confirmed",
  cancelled: "cancelled",
};

async function fetchOrders(legalEntityId: string, from: string, to: string) {
  const { data, error } = await admin
    .from("orders")
    .select(
      "id, customer_id, delivery_date, delivery_time, delivery_tour_id, status, created_at, updated_at, delivery_tours(tour_number, time_from, time_to), order_lines(product_id, quantity, sales_unit, notes)",
    )
    .eq("legal_entity_id", legalEntityId)
    .gte("delivery_date", from)
    .lte("delivery_date", to)
    .neq("status", "cancelled")
    .order("delivery_date");
  if (error) throw error;
  return (data ?? []).map((o: any) => ({
    id: o.id,
    customer_id: o.customer_id,
    delivery_date: o.delivery_date,
    delivery_window: o.delivery_tours
      ? { from: o.delivery_tours.time_from, to: o.delivery_tours.time_to }
      : o.delivery_time
      ? { from: o.delivery_time, to: o.delivery_time }
      : null,
    trip: o.delivery_tours?.tour_number ?? null,
    status: STATUS_MAP[o.status] ?? "confirmed",
    lines: (o.order_lines ?? []).map((l: any) => ({
      product_id: l.product_id,
      quantity: Number(l.quantity),
      unit: l.sales_unit ?? "stk",
      note: l.notes ?? null,
    })),
    created_at: o.created_at,
    updated_at: o.updated_at,
  }));
}

function validDate(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ---------- Router ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  // Path etter funksjonsnavnet: /pakkesystem-api/<endpoint>
  const path = url.pathname.replace(/^\/pakkesystem-api/, "") || "/";
  const qp = Object.fromEntries(url.searchParams.entries());

  if (req.method !== "GET") return err(405, "method_not_allowed", "Kun GET er støttet");

  const auth = await authenticate(req);
  if ("error" in auth) return auth.error;
  const { id: apiKeyId, legal_entity_id: legalEntityId } = auth.key;

  const rl = await checkRateLimit(apiKeyId);
  if (rl) return rl;

  const respond = (endpoint: string, response: Response, rowCount: number | null) =>
    logAndReturn({
      apiKeyId,
      legalEntityId,
      endpoint,
      queryParams: qp,
      statusCode: response.status,
      rowCount,
      req,
      response,
    });

  try {
    if (path === "/products" || path === "/products/") {
      const rows = await fetchProducts(legalEntityId);
      return respond("products", jsonResponse({ products: rows }), rows.length);
    }
    if (path === "/customers" || path === "/customers/") {
      const rows = await fetchCustomers(legalEntityId);
      return respond("customers", jsonResponse({ customers: rows }), rows.length);
    }
    if (path === "/orders" || path === "/orders/") {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (!validDate(from) || !validDate(to)) {
        return respond("orders", err(400, "invalid_params", "from og to må være YYYY-MM-DD"), null);
      }
      const rows = await fetchOrders(legalEntityId, from, to);
      return respond("orders", jsonResponse({ orders: rows }), rows.length);
    }
    if (path === "/snapshot" || path === "/snapshot/") {
      const date = url.searchParams.get("date");
      if (!validDate(date)) {
        return respond("snapshot", err(400, "invalid_params", "date må være YYYY-MM-DD"), null);
      }
      const [products, customers, orders, entity] = await Promise.all([
        fetchProducts(legalEntityId),
        fetchCustomers(legalEntityId),
        fetchOrders(legalEntityId, date, date),
        admin.from("legal_entities").select("id, short_code, legal_name").eq("id", legalEntityId).maybeSingle(),
      ]);
      const body = {
        schema_version: "1.0",
        generated_at: new Date().toISOString(),
        bakery: {
          id: entity.data?.short_code ?? legalEntityId,
          name: entity.data?.legal_name ?? "",
        },
        delivery_date: date,
        products,
        customers,
        orders,
      };
      return respond("snapshot", jsonResponse(body), orders.length);
    }
    return respond(path, err(404, "not_found", `Ukjent endepunkt: ${path}`), null);
  } catch (e) {
    console.error("pakkesystem-api error", e);
    const message = e instanceof Error ? e.message : String(e);
    return respond(path, err(500, "internal_error", message), null);
  }
});
