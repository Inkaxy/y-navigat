// Deklarasjonseksport: ingrediensliste, allergener og næringsinnhold for varer
// som står som «Merking: Godkjent». Kun API-nøkkel med rettigheten «declarations».
//
// GET /declarations-export?updated_since=<ISO>&product_ids=a,b&page=1&page_size=200
// GET /declarations-export?schema=1   -> JSON Schema for responsen
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkApiKey, contentHash, exportRejection } from "../_shared/declaration-export.ts";

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
          approved_at: { type: ["string", "null"], format: "date-time" },
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

/** Fjerner *uthevingsmarkører* uten å røre selve teksten. */
function stripMarkers(text: string): string {
  return text.replace(/\*{1,2}(.+?)\*{1,2}/g, "$1").replace(/\s+/g, " ").trim();
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

  let productQuery = admin
    .from("products")
    .select(
      "id, code, display_number, display_name, ean_code, unit_of_sale, in_web_shop, status, weight_per_unit_grams, " +
        "manual_ingredient_declaration, manual_allergens_contains, manual_allergens_may_contain, " +
        "manual_nutrition_per_100g, manual_declaration_updated_at, declaration_needs_review, updated_at",
    )
    .eq("legal_entity_id", legalEntityId)
    .neq("status", "discontinued")
    .not("manual_ingredient_declaration", "is", null)
    .order("display_number", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize); // henter én ekstra for has_more

  if (productIds.length) productQuery = productQuery.in("id", productIds);
  if (updatedSince) {
    productQuery = productQuery.or(
      `updated_at.gte.${updatedSince},manual_declaration_updated_at.gte.${updatedSince}`,
    );
  }

  const { data: productRows, error: productErr } = await productQuery;
  if (productErr) return jsonRes({ error: productErr.message, code: "query_failed" }, 500);

  const rows = productRows ?? [];
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;

  const ids = pageRows.map((p) => p.id as string);
  const { data: linkRows } = ids.length
    ? await admin
        .from("product_recipe_links")
        .select("product_id, recipe_id, is_primary")
        .in("product_id", ids)
    : { data: [] as { product_id: string; recipe_id: string | null; is_primary: boolean | null }[] };

  const linkByProduct = new Map<string, { recipe_id: string | null }>();
  for (const l of linkRows ?? []) {
    const existing = linkByProduct.get(l.product_id as string);
    if (!existing || l.is_primary) linkByProduct.set(l.product_id as string, { recipe_id: l.recipe_id as string | null });
  }
  const recipeIds = [...new Set([...linkByProduct.values()].map((l) => l.recipe_id).filter(Boolean))] as string[];

  const { data: recipeRows } = recipeIds.length
    ? await admin
        .from("recipes")
        .select("id, name, unit_weight_grams, shelf_life_days, storage_instructions, country_of_origin")
        .in("id", recipeIds)
    : { data: [] as Record<string, unknown>[] };
  const recipeById = new Map((recipeRows ?? []).map((r) => [r.id as string, r]));

  const { data: calcRows } = recipeIds.length
    ? await admin.from("recipe_label_calculated").select("recipe_id, computed_at, is_stale").in("recipe_id", recipeIds)
    : { data: [] as { recipe_id: string; computed_at: string | null; is_stale: boolean | null }[] };
  const calcByRecipe = new Map((calcRows ?? []).map((c) => [c.recipe_id as string, c]));

  const { data: entity } = await admin
    .from("legal_entities")
    .select("id, legal_name, display_name, organization_number, invoice_address_line1, invoice_postal_code, invoice_city")
    .eq("id", legalEntityId)
    .maybeSingle();
  const bakeryAddress = entity
    ? [entity.invoice_address_line1, [entity.invoice_postal_code, entity.invoice_city].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ") || null
    : null;

  const products: Record<string, unknown>[] = [];
  for (const p of pageRows) {
    const link = linkByProduct.get(p.id as string) ?? null;
    const recipe = link?.recipe_id ? recipeById.get(link.recipe_id) ?? null : null;
    const calc = link?.recipe_id ? calcByRecipe.get(link.recipe_id) ?? null : null;

    const rejection = exportRejection({
      ingredientText: p.manual_ingredient_declaration as string | null,
      needsReview: p.declaration_needs_review as boolean | null,
      calculated: link?.recipe_id
        ? { computed_at: (calc?.computed_at as string | null) ?? null, is_stale: (calc?.is_stale as boolean | null) ?? null }
        : null,
    });
    if (rejection) continue;

    const text = String(p.manual_ingredient_declaration ?? "");
    const item = {
      id: p.id,
      product_number: p.display_number != null ? String(p.display_number) : null,
      code: p.code ?? null,
      name: p.display_name ?? "",
      ean: p.ean_code ?? null,
      unit_of_sale: p.unit_of_sale ?? null,
      in_web_shop: p.in_web_shop ?? null,
      ingredient_text: text,
      ingredient_text_plain: stripMarkers(text),
      allergens_contains: (p.manual_allergens_contains as string[] | null) ?? [],
      allergens_may_contain: (p.manual_allergens_may_contain as string[] | null) ?? [],
      nutrition_per_100g: (p.manual_nutrition_per_100g as Record<string, number | null> | null) ?? null,
      net_weight_grams:
        (p.weight_per_unit_grams as number | null) ?? ((recipe?.unit_weight_grams as number | null) ?? null),
      shelf_life_days: (recipe?.shelf_life_days as number | null) ?? null,
      storage_instructions: (recipe?.storage_instructions as string | null) ?? null,
      country_of_origin: (recipe?.country_of_origin as string | null) ?? null,
      recipe_name: (recipe?.name as string | null) ?? null,
      approved_at: (p.manual_declaration_updated_at as string | null) ?? (calc?.computed_at as string | null) ?? null,
    };
    products.push({ ...item, content_hash: await contentHash(item) });
  }

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
