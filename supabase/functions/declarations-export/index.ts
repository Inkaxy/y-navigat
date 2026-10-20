// Deklarasjonseksport: ingrediensliste, allergener og næringsinnhold for varer
// som står som «Merking: Godkjent». Kun API-nøkkel med rettigheten «declarations».
//
// GET /declarations-export?updated_since=<ISO>&product_ids=a,b&page=1&page_size=200
// GET /declarations-export?schema=1   -> JSON Schema for responsen
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkApiKey } from "../_shared/declaration-export.ts";
import { buildDeclarationsPage } from "./page.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SCHEMA_VERSION = "1.0";
const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 200;

const JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "NBhub Declarations Export",
  type: "object",
  required: ["schema_version", "generated_at", "bakery", "page", "page_size", "has_more", "products"],
  properties: {
    schema_version: { const: SCHEMA_VERSION },
    generated_at: { type: "string", format: "date-time" },
    bakery: {
      type: "object",
      required: ["id", "name"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        address: { type: ["string", "null"] },
      },
    },
    page: { type: "integer" },
    page_size: { type: "integer" },
    has_more: { type: "boolean" },
    products: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "product_number", "name", "ingredient_text", "approved_at", "content_hash"],
        properties: {
          id: { type: "string" },
          product_number: { type: ["string", "null"] },
          code: { type: ["string", "null"] },
          name: { type: "string" },
          ean: { type: ["string", "null"] },
          unit_of_sale: { type: ["string", "null"] },
          in_web_shop: { type: ["boolean", "null"] },
          /** Søkeord lagret på varekortet — alternative navn mottaker kan søke på. */
          keywords: { type: "array", items: { type: "string" } },
          /** Ingrediensliste med allergener uthevet som *stjerner*. */
          ingredient_text: { type: "string" },
          /** Samme tekst uten uthevingsmarkører. */
          ingredient_text_plain: { type: "string" },
          allergens_contains: { type: "array", items: { type: "string" } },
          allergens_may_contain: { type: "array", items: { type: "string" } },
          nutrition_per_100g: {
            type: ["object", "null"],
            properties: {
              energy_kj: { type: ["number", "null"] },
              energy_kcal: { type: ["number", "null"] },
              fat_g: { type: ["number", "null"] },
              saturated_fat_g: { type: ["number", "null"] },
              carbs_g: { type: ["number", "null"] },
              sugars_g: { type: ["number", "null"] },
              protein_g: { type: ["number", "null"] },
              salt_g: { type: ["number", "null"] },
              fiber_g: { type: ["number", "null"] },
            },
          },
          net_weight_grams: { type: ["number", "null"] },
          shelf_life_days: { type: ["integer", "null"] },
          storage_instructions: { type: ["string", "null"] },
          country_of_origin: { type: ["string", "null"] },
          recipe_name: { type: ["string", "null"] },
          grain: {
            type: ["object", "null"],
            description: "Brødskala'n. Null når varen ikke har grovhetsgrunnlag.",
            properties: {
              level: { enum: ["fint", "halvgrovt", "grovt", "ekstra_grovt"] },
              label: { type: "string" },
              pct: { type: ["number", "null"] },
              pieces: { type: "integer", minimum: 1, maximum: 4 },
              pieces_total: { const: 4 },
              source: { enum: ["manual", "auto"] },
            },
          },
          approved_at: { type: ["string", "null"], format: "date-time" },
          needs_review: { type: "boolean", description: "Nye endringer venter på gjennomgang; publisert innhold er sist godkjente versjon." },
          review_reason: { type: ["string", "null"] },
          declaration_version: { type: ["integer", "null"] },
          declaration_source: { enum: ["approved_version", "legacy"] },
          content_hash: { type: "string" },
        },
      },
    },
  },
} as const;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  if (url.searchParams.get("schema") === "1") return jsonRes(JSON_SCHEMA);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return jsonRes({ error: "Manglende Authorization: Bearer <nøkkel>", code: "unauthorized" }, 401);

  const { data: keyRow } = await admin
    .from("pakkesystem_api_keys")
    .select("id, legal_entity_id, revoked_at, scopes")
    .eq("key_hash", await sha256Hex(bearer))
    .maybeSingle();

  const check = checkApiKey(keyRow ?? null);
  if (!check.ok) {
    const message =
      check.code === "revoked"
        ? "API-nøkkelen er tilbakekalt"
        : check.code === "forbidden_scope"
          ? "API-nøkkelen har ikke rettigheten «declarations»"
          : "Ukjent API-nøkkel";
    return jsonRes({ error: message, code: check.code }, check.code === "forbidden_scope" ? 403 : 401);
  }
  const { keyId, legalEntityId } = check;
  admin.from("pakkesystem_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyId).then();

  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(url.searchParams.get("page_size") ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE),
  );
  const updatedSince = url.searchParams.get("updated_since");
  if (updatedSince && Number.isNaN(Date.parse(updatedSince))) {
    return jsonRes({ error: "Ugyldig updated_since — bruk ISO-tidspunkt", code: "invalid_updated_since" }, 400);
  }
  const productIds = (url.searchParams.get("product_ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const built = await buildDeclarationsPage(admin, {
    legalEntityId,
    page,
    pageSize,
    updatedSince,
    productIds,
  });
  if (!built.ok) return jsonRes({ error: built.error, code: built.code }, built.status);
  const { products, hasMore } = built;
  const entity = built.entity as Record<string, string | null> | null;
  const bakeryAddress = entity
    ? [entity.invoice_address_line1, [entity.invoice_postal_code, entity.invoice_city].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ") || null
    : null;

  const payload = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    bakery: {
      id: entity?.organization_number ?? entity?.id ?? legalEntityId,
      name: entity?.legal_name ?? entity?.display_name ?? "",
      address: bakeryAddress,
    },
    page,
    page_size: pageSize,
    has_more: hasMore,
    products,
  };

  admin
    .from("pakkesystem_api_log")
    .insert({
      api_key_id: keyId,
      legal_entity_id: legalEntityId,
      endpoint: "declarations-export",
      query_params: { page, page_size: pageSize, updated_since: updatedSince, product_ids: productIds },
      status_code: 200,
      row_count: products.length,
      ip: req.headers.get("x-forwarded-for") ?? null,
      ua: req.headers.get("user-agent") ?? null,
    })
    .then();

  return jsonRes(payload);
});
