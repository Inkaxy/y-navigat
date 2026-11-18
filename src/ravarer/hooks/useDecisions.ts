import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import type { RawMaterialReadiness } from "@/ravarer/lib/decisions";

const CHUNK = 100;
const PAGE = 1000;

function chunks<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Komplett uthenting av (raw_material_id, recipe_id) for gitte råvarer, side for side til tom side. */
async function recipeCounts(ids: readonly string[]): Promise<Map<string, number>> {
  const sets = new Map<string, Set<string>>();
  for (const part of chunks(ids, CHUNK)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from("recipe_lines").select("raw_material_id, recipe_id")
        .in("raw_material_id", part).order("id").range(from, from + PAGE - 1);
      if (error) throw error;
      for (const r of data ?? []) {
        if (!r.raw_material_id || !r.recipe_id) continue;
        const s = sets.get(r.raw_material_id) ?? new Set<string>();
        s.add(r.recipe_id);
        sets.set(r.raw_material_id, s);
      }
      if (!data || data.length < PAGE) break;
    }
  }
  return new Map([...sets].map(([k, v]) => [k, v.size]));
}

async function idsIn(table: "raw_material_products" | "recipe_packaging_lines", ids: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const part of chunks(ids, CHUNK)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from(table).select("raw_material_id").in("raw_material_id", part).order("id").range(from, from + PAGE - 1);
      if (error) throw error;
      for (const r of data ?? []) if (r.raw_material_id) out.add(r.raw_material_id);
      if (!data || data.length < PAGE) break;
    }
  }
  return out;
}

/** Klarhet for råvarer med åpne spørsmål (videresalg/emballasje/allergener). Feil = ingen tilleggsspørsmål, aldri falske. */
export function useRawMaterialReadiness(ids: readonly string[]) {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  const key = [...ids].sort().join(",");
  return useQuery({
    queryKey: ["ravarer", "decision-readiness", le, key],
    enabled: !!le && ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<RawMaterialReadiness[]> => {
      const rows: { id: string; name: string; item_type: string | null; allergens_reviewed_at: string | null }[] = [];
      for (const part of chunks(ids, CHUNK)) {
        const { data, error } = await supabase.from("raw_materials").select("id, name, item_type, allergens_reviewed_at")
          .eq("legal_entity_id", le!).in("id", part);
        if (error) throw error;
        rows.push(...(data ?? []));
      }
      const resale = rows.filter((r) => r.item_type === "videresalg").map((r) => r.id);
      const pack = rows.filter((r) => r.item_type === "emballasje").map((r) => r.id);
      const unreviewed = rows.filter((r) => r.item_type === "ravare" && r.allergens_reviewed_at == null).map((r) => r.id);
      const [sold, packed, recipes] = await Promise.all([
        resale.length ? idsIn("raw_material_products", resale) : Promise.resolve(new Set<string>()),
        pack.length ? idsIn("recipe_packaging_lines", pack) : Promise.resolve(new Set<string>()),
        unreviewed.length ? recipeCounts(unreviewed) : Promise.resolve(new Map<string, number>()),
      ]);
      return rows.map((r) => ({
        ...r,
        recipes: unreviewed.includes(r.id) ? recipes.get(r.id) ?? 0 : null,
        sold_as_product: r.item_type === "videresalg" ? sold.has(r.id) : null,
        used_as_packaging: r.item_type === "emballasje" ? packed.has(r.id) : null,
      }));
    },
  });
}
