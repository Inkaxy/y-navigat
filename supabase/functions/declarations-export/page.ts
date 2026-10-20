// Bygger én side av deklarasjonseksporten. Ren mot en minimal klient slik at
// selve endepunktlogikken kan testes med en falsk database (vitest).
import {
  approvedContent,
  contentHash,
  exportDecision,
  exportGrain,
  type ApprovedVersion,
} from "../_shared/declaration-export.ts";

type Row = Record<string, unknown>;
type Res = { data: Row[] | Row | null; error: { message: string } | null };
/** Minimal kjedbar spørring — samme metoder som supabase-js bruker her. */
export interface Query extends PromiseLike<Res> {
  select(cols: string): Query;
  eq(c: string, v: unknown): Query;
  neq(c: string, v: unknown): Query;
  not(c: string, op: string, v: unknown): Query;
  in(c: string, v: unknown[]): Query;
  or(f: string): Query;
  order(c: string, o: { ascending: boolean }): Query;
  range(a: number, b: number): Query;
  maybeSingle(): PromiseLike<Res>;
}
export interface Db {
  from(table: string): Query;
}

export interface PageInput {
  legalEntityId: string;
  page: number;
  pageSize: number;
  updatedSince: string | null;
  productIds: string[];
}

export type PageResult =
  | { ok: true; products: Row[]; hasMore: boolean; entity: Row | null }
  | { ok: false; status: number; error: string; code: string };

/** Fjerner *uthevingsmarkører* uten å røre selve teksten. */
export function stripMarkers(text: string): string {
  return text.replace(/\*{1,2}(.+?)\*{1,2}/g, "$1").replace(/\s+/g, " ").trim();
}

const rows = (d: Res["data"]): Row[] => (Array.isArray(d) ? d : d ? [d] : []);

export async function buildDeclarationsPage(admin: Db, o: PageInput): Promise<PageResult> {
  let productQuery = admin
    .from("products")
    .select(
      "id, code, display_number, display_name, ean_code, unit_of_sale, in_web_shop, status, weight_per_unit_grams, keywords, " +
        "manual_ingredient_declaration, manual_allergens_contains, manual_allergens_may_contain, " +
        "manual_nutrition_per_100g, manual_declaration_updated_at, declaration_needs_review, declaration_review_reason, declaration_version_id, updated_at",
    )
    .eq("legal_entity_id", o.legalEntityId)
    .neq("status", "discontinued")
    .not("manual_ingredient_declaration", "is", null)
    .order("display_number", { ascending: true })
    .range((o.page - 1) * o.pageSize, o.page * o.pageSize); // én ekstra for has_more
  if (o.productIds.length) productQuery = productQuery.in("id", o.productIds);
  if (o.updatedSince) {
    productQuery = productQuery.or(`updated_at.gte.${o.updatedSince},manual_declaration_updated_at.gte.${o.updatedSince}`);
  }
  const { data: productData, error: productErr } = await productQuery;
  if (productErr) return { ok: false, status: 500, error: productErr.message, code: "query_failed" };

  const all = rows(productData);
  const hasMore = all.length > o.pageSize;
  const pageRows = hasMore ? all.slice(0, o.pageSize) : all;
  const ids = pageRows.map((p) => p.id as string);

  const linkRows = ids.length
    ? rows((await admin.from("product_recipe_links").select("product_id, recipe_id, is_primary").in("product_id", ids)).data)
    : [];
  const linkByProduct = new Map<string, { recipe_id: string | null }>();
  for (const l of linkRows) {
    const existing = linkByProduct.get(l.product_id as string);
    if (!existing || l.is_primary) linkByProduct.set(l.product_id as string, { recipe_id: l.recipe_id as string | null });
  }
  const recipeIds = [...new Set([...linkByProduct.values()].map((l) => l.recipe_id).filter(Boolean))] as string[];

  const recipeRows = recipeIds.length
    ? rows((await admin
        .from("recipes")
        .select("id, name, unit_weight_grams, shelf_life_days, storage_instructions, country_of_origin, breadscale_mode, manual_breadscale_pct")
        .in("id", recipeIds)).data)
    : [];
  const recipeById = new Map(recipeRows.map((r) => [r.id as string, r]));

  const calcRows = recipeIds.length
    ? rows((await admin
        .from("recipe_label_calculated")
        .select("recipe_id, computed_at, is_stale, grain_category, grain_score_pct")
        .in("recipe_id", recipeIds)).data)
    : [];
  const calcByRecipe = new Map(calcRows.map((c) => [c.recipe_id as string, c]));

  // Godkjente snapshots er fasit. Feiler oppslaget, stopper vi heller enn å
  // publisere løpende eller ufullstendige data.
  const versionIds = [...new Set(pageRows.map((p) => p.declaration_version_id as string | null).filter(Boolean))] as string[];
  const versionById = new Map<string, ApprovedVersion>();
  if (versionIds.length) {
    const { data: vData, error: vErr } = await admin
      .from("recipe_declaration_versions")
      .select(
        "id, version, source, approved_at, ingredient_text, ingredient_html, allergens_contains, allergens_may_contain, " +
          "nutrition_per_100g, net_weight_g, shelf_life_days, storage_text, origin_text, claim_grain, claim_keyhole, breadscale_pct",
      )
      .in("id", versionIds);
    if (vErr) return { ok: false, status: 500, error: "Kunne ikke lese godkjente versjoner", code: "query_failed" };
    for (const v of rows(vData)) versionById.set(v.id as string, v as unknown as ApprovedVersion);
  }

  const entityRes = await admin
    .from("legal_entities")
    .select("id, legal_name, display_name, organization_number, invoice_address_line1, invoice_postal_code, invoice_city")
    .eq("id", o.legalEntityId)
    .maybeSingle();
  const entity = (entityRes.data as Row | null) ?? null;

  const products: Row[] = [];
  for (const p of pageRows) {
    const link = linkByProduct.get(p.id as string) ?? null;
    const recipe = link?.recipe_id ? recipeById.get(link.recipe_id) ?? null : null;
    const calc = link?.recipe_id ? calcByRecipe.get(link.recipe_id) ?? null : null;
    const versionId = (p.declaration_version_id as string | null) ?? null;
    const version = versionId ? versionById.get(versionId) ?? null : null;

    const decision = exportDecision({
      ingredientText: p.manual_ingredient_declaration as string | null,
      needsReview: p.declaration_needs_review as boolean | null,
      calculated: link?.recipe_id
        ? { computed_at: (calc?.computed_at as string | null) ?? null, is_stale: (calc?.is_stale as boolean | null) ?? null }
        : null,
      versionId,
      version,
    });
    if (!decision.include) continue;

    const productWeight = (p.weight_per_unit_grams as number | null) ?? null;
    const published = decision.source === "approved_version" && version
      ? {
          ...approvedContent(version),
          // Produktets egen vekt er bevisst produktdata (variant); ellers godkjent vekt — null er autoritativt.
          net_weight_grams: productWeight ?? (version.net_weight_g ?? null),
        }
      : {
          // Legacy uten versjon: produktets lagrede snapshot + oppskriftens felt (uendret regel).
          ingredient_text: String(p.manual_ingredient_declaration ?? ""),
          allergens_contains: (p.manual_allergens_contains as string[] | null) ?? [],
          allergens_may_contain: (p.manual_allergens_may_contain as string[] | null) ?? [],
          nutrition_per_100g: (p.manual_nutrition_per_100g as Record<string, number | null> | null) ?? null,
          shelf_life_days: (recipe?.shelf_life_days as number | null) ?? null,
          storage_instructions: (recipe?.storage_instructions as string | null) ?? null,
          country_of_origin: (recipe?.country_of_origin as string | null) ?? null,
          grain: recipe
            ? exportGrain({
                mode: recipe.breadscale_mode as string | null,
                manualPct: recipe.manual_breadscale_pct as number | null,
                calcCategory: (calc?.grain_category as string | null) ?? null,
                calcPct: (calc?.grain_score_pct as number | null) ?? null,
              })
            : null,
          approved_at: (p.manual_declaration_updated_at as string | null) ?? (calc?.computed_at as string | null) ?? null,
          net_weight_grams: productWeight ?? ((recipe?.unit_weight_grams as number | null) ?? null),
        };
    const text = published.ingredient_text;
    const item = {
      id: p.id,
      product_number: p.display_number != null ? String(p.display_number) : null,
      code: p.code ?? null,
      name: p.display_name ?? "",
      ean: p.ean_code ?? null,
      unit_of_sale: p.unit_of_sale ?? null,
      in_web_shop: p.in_web_shop ?? null,
      keywords: ((p.keywords as string[] | null) ?? []).map((k) => String(k).trim()).filter(Boolean),
      ingredient_text: text,
      ingredient_text_plain: stripMarkers(text),
      allergens_contains: published.allergens_contains,
      allergens_may_contain: published.allergens_may_contain,
      nutrition_per_100g: published.nutrition_per_100g,
      net_weight_grams: published.net_weight_grams,
      shelf_life_days: published.shelf_life_days,
      storage_instructions: published.storage_instructions,
      country_of_origin: published.country_of_origin,
      grain: published.grain,
      approved_at: published.approved_at,
    };
    // Utenfor content_hash: review-status og løpende oppskriftsnavn er ikke
    // publisert deklarasjonsinnhold og skal ikke ugyldiggjøre mottakerens cache.
    const extra = {
      recipe_name: (recipe?.name as string | null) ?? null,
      needs_review: decision.needsReview,
      review_reason: decision.needsReview ? ((p.declaration_review_reason as string | null) ?? null) : null,
      declaration_version: version?.version ?? null,
      declaration_source: decision.source,
    };
    products.push({ ...item, ...extra, content_hash: await contentHash(item) });
  }
  return { ok: true, products, hasMore, entity };
}
