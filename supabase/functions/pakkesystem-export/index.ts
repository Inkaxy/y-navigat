// Pakkesystem-eksport: JSON-snapshot av produkter, kunder og ordre for én leveringsdag.
// Auth: enten Bearer <api-key> (fra pakkesystem_api_keys) eller Supabase user JWT.
// GET  /pakkesystem-export?date=YYYY-MM-DD[&legal_entity_id=...]
// GET  /pakkesystem-export?schema=1   -> JSON Schema for responsen
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SCHEMA_VERSION = "1.0";

const JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "NBhub Pakkesystem Export",
  type: "object",
  required: ["schema_version", "generated_at", "bakery", "delivery_date", "products", "customers", "orders"],
  properties: {
    schema_version: { const: SCHEMA_VERSION },
    generated_at: { type: "string", format: "date-time" },
    bakery: {
      type: "object",
      required: ["id", "name"],
      properties: { id: { type: "string" }, name: { type: "string" } },
    },
    delivery_date: { type: "string", format: "date" },
    products: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "product_number", "name", "active"],
        properties: {
          id: { type: "string" },
          product_number: { type: "string" },
          name: { type: "string" },
          category: { type: ["string", "null"] },
          pieces_per_tray: { type: ["number", "null"] },
          ean: { type: ["string", "null"] },
          unit_price: { type: ["number", "null"] },
          active: { type: "boolean" },
        },
      },
    },
    customers: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "customer_number", "name"],
        properties: {
          id: { type: "string" },
          customer_number: { type: "string" },
          name: { type: "string" },
          address: {
            type: "object",
            properties: {
              street: { type: ["string", "null"] },
              postal_code: { type: ["string", "null"] },
              city: { type: ["string", "null"] },
            },
          },
          phone: { type: ["string", "null"] },
          email: { type: ["string", "null"] },
          delivery_route: { type: ["string", "null"] },
          delivery_sequence: { type: ["integer", "null"] },
          notes: { type: ["string", "null"] },
        },
      },
    },
    orders: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "customer_id", "delivery_date", "lines", "updated_at"],
        properties: {
          id: { type: "string" },
          customer_id: { type: "string" },
          delivery_date: { type: "string", format: "date" },
          delivery_window: {
            type: ["object", "null"],
            properties: { from: { type: "string" }, to: { type: "string" } },
          },
          trip: { type: ["integer", "null"] },
          status: { enum: ["draft", "confirmed", "cancelled"] },
          lines: {
            type: "array",
            items: {
              type: "object",
              required: ["product_id", "quantity", "unit"],
              properties: {
                product_id: { type: "string" },
                quantity: { type: "number" },
                unit: { type: "string" },
                note: { type: ["string", "null"] },
              },
            },
          },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
    },
  },
} as const;

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  if (url.searchParams.get("schema") === "1") {
    return jsonRes(JSON_SCHEMA);
  }

  const dateParam = url.searchParams.get("date");
  const requestedEntity = url.searchParams.get("legal_entity_id");

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateParam || !dateRe.test(dateParam)) {
    return jsonRes({ error: "Ugyldig eller manglende ?date=YYYY-MM-DD", code: "invalid_date" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // --- Autentisering ---
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!bearer) {
    return jsonRes({ error: "Manglende Authorization: Bearer <nøkkel>", code: "unauthorized" }, 401);
  }

  let legalEntityId: string | null = null;
  let apiKeyId: string | null = null;

  if (bearer.startsWith("nbps_")) {
    // API-nøkkel: sammenlign SHA-256 mot pakkesystem_api_keys.key_hash
    const keyHash = await sha256Hex(bearer);
    const { data: keyRow, error: keyErr } = await admin
      .from("pakkesystem_api_keys")
      .select("id, legal_entity_id, revoked_at")
      .eq("key_hash", keyHash)
      .maybeSingle();
    if (keyErr || !keyRow) {
      return jsonRes({ error: "Ukjent API-nøkkel", code: "unauthorized" }, 401);
    }
    if (keyRow.revoked_at) {
      return jsonRes({ error: "API-nøkkel er tilbakekalt", code: "revoked" }, 401);
    }
    legalEntityId = keyRow.legal_entity_id;
    apiKeyId = keyRow.id;
    admin.from("pakkesystem_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRow.id).then();
  } else {
    // Supabase user JWT (fra UI). Verifiser og krev legal_entity_id-param.
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return jsonRes({ error: "Ugyldig session", code: "unauthorized" }, 401);
    }
    if (!requestedEntity) {
      return jsonRes({ error: "legal_entity_id kreves ved bruker-innlogging", code: "missing_entity" }, 400);
    }
    legalEntityId = requestedEntity;
  }

  if (!legalEntityId) return jsonRes({ error: "Fant ikke selskap", code: "no_entity" }, 400);

  // --- Hent data ---
  const { data: entity } = await admin
    .from("legal_entities")
    .select("id, legal_name, organization_number")
    .eq("id", legalEntityId)
    .maybeSingle();

  const { data: productsRaw, error: prodErr } = await admin
    .from("products")
    .select("id, display_number, code, display_name, unit_of_sale, pieces_per_unit, ean_code, gtin, status, main_category_id, product_main_categories(display_name)")
    .eq("legal_entity_id", legalEntityId);
  if (prodErr) return jsonRes({ error: prodErr.message, code: "products_failed" }, 500);

  const { data: ordersRaw, error: ordErr } = await admin
    .from("orders")
    .select(`
      id, order_number, customer_id, status, delivery_date, delivery_time, delivery_tour_id,
      created_at, updated_at,
      order_lines(product_id, quantity, sales_unit, notes),
      delivery_tours(tour_number, time_from, time_to)
    `)
    .eq("legal_entity_id", legalEntityId)
    .eq("delivery_date", dateParam)
    .neq("status", "draft");
  if (ordErr) return jsonRes({ error: ordErr.message, code: "orders_failed" }, 500);

  const customerIds = Array.from(new Set((ordersRaw ?? []).map((o: any) => o.customer_id).filter(Boolean)));
  const { data: customersRaw, error: custErr } = customerIds.length === 0
    ? { data: [], error: null }
    : await admin
        .from("customers")
        .select("id, customer_number, display_name, delivery_address_line1, delivery_postal_code, delivery_city, primary_contact_phone, primary_contact_email, delivery_instructions")
        .in("id", customerIds);
  if (custErr) return jsonRes({ error: custErr.message, code: "customers_failed" }, 500);

  // Bare produkter som brukes i dagens ordre (holder filen liten)
  const usedProductIds = new Set<string>();
  for (const o of ordersRaw ?? []) {
    for (const l of (o.order_lines ?? []) as any[]) usedProductIds.add(l.product_id);
  }

  const products = (productsRaw ?? [])
    .filter((p: any) => usedProductIds.has(p.id) || p.status === "active")
    .map((p: any) => ({
      id: p.id,
      product_number: p.display_number != null ? String(p.display_number) : (p.code ?? p.id),
      name: p.display_name,
      category: p.product_main_categories?.display_name ?? null,
      pieces_per_tray: p.pieces_per_unit != null ? Number(p.pieces_per_unit) : null,
      ean: p.gtin ?? p.ean_code ?? null,
      unit_price: null,
      active: p.status === "active",
    }));

  const customers = (customersRaw ?? []).map((c: any) => ({
    id: c.id,
    customer_number: c.customer_number ?? "",
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

  const orders = (ordersRaw ?? []).map((o: any) => {
    const tour = o.delivery_tours;
    const window = tour?.time_from || tour?.time_to
      ? { from: (tour.time_from ?? "").slice(0, 5), to: (tour.time_to ?? "").slice(0, 5) }
      : (o.delivery_time ? { from: o.delivery_time.slice(0, 5), to: o.delivery_time.slice(0, 5) } : null);
    return {
      id: o.order_number ?? o.id,
      customer_id: o.customer_id,
      delivery_date: o.delivery_date,
      delivery_window: window,
      trip: tour?.tour_number ?? null,
      status: o.status === "cancelled" ? "cancelled" : "confirmed",
      lines: (o.order_lines ?? []).map((l: any) => ({
        product_id: l.product_id,
        quantity: Number(l.quantity),
        unit: l.sales_unit ?? "stk",
        note: l.notes ?? null,
      })),
      created_at: o.created_at,
      updated_at: o.updated_at,
    };
  });

  const payload = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    bakery: {
      id: entity?.organization_number ?? entity?.id ?? legalEntityId,
      name: entity?.legal_name ?? "",
    },
    delivery_date: dateParam,
    products,
    customers,
    orders,
  };

  // Logg forespørselen (bare API-key-baserte forespørsler ryddig)
  if (apiKeyId) {
    admin.from("pakkesystem_api_log").insert({
      api_key_id: apiKeyId,
      legal_entity_id: legalEntityId,
      endpoint: "pakkesystem-export",
      query_params: { date: dateParam },
      status_code: 200,
      row_count: orders.length,
      ip: req.headers.get("x-forwarded-for") ?? null,
      ua: req.headers.get("user-agent") ?? null,
    }).then();
  }

  return jsonRes(payload);
});
