import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { useActivityFeed, useWorkItems } from "@/ravarer/hooks/useWorkData";
import {
  decisionsFromWork, extraDecisions, openQuestionCount, sortDecisions, type RawMaterialReadiness,
} from "@/ravarer/lib/decisions";
import { osloTodayISO, osloDateISO } from "@/lib/osloDate";

/** rm_work_items gir høyst 500 per side. */
export const DECISION_LIMIT = 500;
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

/** Beslutningskøen: køens spørsmål (eldste fakturadato først) + tilleggsspørsmål om råvarene. */
export function useDecisions() {
  const work = useWorkItems({ group: "alle", sort: "oldest", limit: DECISION_LIMIT });
  const base = useMemo(() => decisionsFromWork(work.data?.items ?? []), [work.data]);
  const rmIds = useMemo(() => [...new Set(base.flatMap((d) => (d.source.kind === "work" && d.source.item.rm_id ? [d.source.item.rm_id] : [])))], [base]);
  const readiness = useRawMaterialReadiness(rmIds);
  const decisions = useMemo(() => sortDecisions([...base, ...extraDecisions(base, readiness.data ?? [])]), [base, readiness.data]);
  return {
    work, readiness, decisions,
    openCount: openQuestionCount(work.data?.counts),
    extraCount: decisions.length - base.length,
    truncated: (work.data?.total ?? 0) > (work.data?.items.length ?? 0),
  };
}

/** Nøkkeltall for i dag fra aktivitetsloggen (Oslo-dato). Null = ukjent. */
export function useTodayActivity() {
  const feed = useActivityFeed({ days: 1, limit: 200 });
  return useMemo(() => {
    if (!feed.data) return { linesSolved: null as number | null, invoicesReleased: null as number | null, isError: feed.isError };
    const today = osloTodayISO();
    const items = feed.data.items.filter((i) => osloDateISO(i.at) === today);
    const sum = (pred: (k: string) => boolean) => items.filter((i) => pred(i.kind)).reduce((s, i) => s + Math.max(1, i.count), 0);
    return {
      linesSolved: sum((k) => ["pris_godtatt", "kobling_bekreftet", "ikke_vare", "pakning_bekreftet_auto", "forste_pris", "gjentatt_pris"].includes(k)),
      invoicesReleased: sum((k) => k === "faktura_avstemt" || k === "faktura_avstemt_auto"),
      isError: false,
    };
  }, [feed.data, feed.isError]);
}

/** Bare telleren til menyen (samme tellere som køen, uten å hente elementene). */
export function useOpenQuestionCount(enabled: boolean) {
  // Delte tellere: ingen egne rm_work_items-kall når en liste på siden allerede har hentet dem.
  const q = useWorkCounts(enabled);
  return openQuestionCount(q.data);
}
