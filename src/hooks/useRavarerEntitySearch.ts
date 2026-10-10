import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { useRavarerAccessLevel } from "@/ravarer/hooks/useRavarerAccessLevel";
import {
  MAX_HITS_PER_GROUP,
  MIN_SEARCH_LENGTH,
  buildIlikeOr,
  mergeRawMaterialHits,
  sanitizeSearchTerm,
  type EntityHit,
} from "@/lib/entitySearch";

/**
 * Råvare- og leverandørsøk i kommandopaletten. Kjøres bare for brukere med
 * lesetilgang til Råvarer — RLS stopper uansett, men da slipper vi tomme kall.
 * Råvarer finnes på navn, varenummer og bekreftede leverandøralias.
 */
export function useRavarerEntitySearch(rawTerm: string) {
  const { data: company } = useCompany();
  const entityId = company?.id ?? null;
  const access = useRavarerAccessLevel();
  const canRead = !!access.data && access.data !== "none";
  const canWrite = access.data === "write" || access.data === "approve" || access.data === "admin";
  const term = sanitizeSearchTerm(rawTerm);
  const enabled = canRead && !!entityId && term.length >= MIN_SEARCH_LENGTH;

  const rawMaterials = useQuery({
    queryKey: ["entity-search", "raw-materials", entityId, term],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<EntityHit[]> => {
      const [direct, alias] = await Promise.all([
        supabase
          .from("raw_materials")
          .select("id, name, sku, is_active")
          .eq("legal_entity_id", entityId ?? "")
          .or(buildIlikeOr(["name", "sku"], term))
          .order("is_active", { ascending: false })
          .order("name")
          .limit(MAX_HITS_PER_GROUP),
        supabase
          .from("raw_material_supplier_aliases")
          .select("alias_value, raw_material_suppliers!inner(raw_material_id, raw_materials!inner(id, name, sku, legal_entity_id))")
          .eq("status", "confirmed")
          .eq("raw_material_suppliers.raw_materials.legal_entity_id", entityId ?? "")
          .ilike("alias_value", `%${term}%`)
          .limit(MAX_HITS_PER_GROUP),
      ]);
      if (direct.error) throw direct.error;
      const directHits: EntityHit[] = (direct.data ?? []).map((r) => ({
        kind: "raw_material",
        id: r.id,
        title: r.name,
        subtitle: [r.sku, r.is_active ? null : "Inaktiv"].filter(Boolean).join(" · ") || undefined,
      }));
      // Aliasoppslaget er et tillegg: feiler det, viser vi likevel navnetreffene.
      const aliasHits: EntityHit[] = alias.error
        ? []
        : (alias.data ?? []).map((a) => {
            const rm = a.raw_material_suppliers.raw_materials;
            return { kind: "raw_material", id: rm.id, title: rm.name, subtitle: `Leverandørnavn: ${a.alias_value}` };
          });
      return mergeRawMaterialHits(directHits, aliasHits);
    },
  });

  const suppliers = useQuery({
    queryKey: ["entity-search", "suppliers", entityId, term],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<EntityHit[]> => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name, org_number, tripletex_supplier_number")
        .eq("legal_entity_id", entityId ?? "")
        .or(buildIlikeOr(["name", "org_number", "tripletex_supplier_number"], term))
        .order("name")
        .limit(MAX_HITS_PER_GROUP);
      if (error) throw error;
      return (data ?? []).map((s) => ({
        kind: "supplier",
        id: s.id,
        title: s.name,
        subtitle: s.org_number ?? undefined,
      }));
    },
  });

  const queries = [rawMaterials, suppliers];
  return {
    canRead,
    canWrite,
    hits: queries.flatMap((q) => q.data ?? []),
    isSearching: enabled && queries.some((q) => q.isFetching),
    isSettled: !enabled || queries.every((q) => !q.isFetching && (q.isSuccess || q.isError)),
  };
}
