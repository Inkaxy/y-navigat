// Én henting av råvarefeltene kalkylene trenger. Tidligere hadde fire steder
// hver sin kolonneliste (og to delte samme query key med ulike kolonner), så
// grunnenhet og prisstatus kunne mangle i cachen. Alle kalkyler bruker nå denne.
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";
import type { BakersRawMaterial } from "./bakers";

export const BAKERS_RM_SELECT =
  "id, name, category, grain_classification, cereal_type, water_content_pct, unit_weight_grams, base_unit, current_cost_price, cost_basis_status, price_source, price_updated_at, produced_by_recipe_id, is_composite, density_g_per_ml, is_water";

export const BAKERS_RM_KEY = (legalEntityId: string | null | undefined, scope: "all" | "active" = "all") =>
  ["rm-bakers-map", legalEntityId ?? null, scope] as const;

type Row = BakersRawMaterial;

/** Henter alle råvarer (paginert) og kaster ved feil — en feil skal aldri se ut som «mangler pris». */
export async function fetchBakersRawMaterials(
  legalEntityId: string | null | undefined,
  opts: { activeOnly?: boolean } = {},
): Promise<Record<string, BakersRawMaterial>> {
  const rows = await fetchAllRows<Row>((from, to) => {
    let q = supabase.from("raw_materials").select(BAKERS_RM_SELECT);
    if (legalEntityId) q = q.eq("legal_entity_id", legalEntityId);
    if (opts.activeOnly) q = q.eq("is_active", true);
    return q.order("id").range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
  });
  const map: Record<string, BakersRawMaterial> = {};
  for (const r of rows) map[r.id] = r;
  return map;
}
