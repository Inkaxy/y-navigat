import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { APP_CODE } from "@/fakturaer/lib/constants";

export interface LegalEntityRow {
  id: string;
  name: string;
  short_code: string | null;
}

/** Returnerer alle legal_entities brukeren har faktura-tilgang til (via posisjon eller eier-flagg). */
export function useFakturaerLegalEntities() {
  return useQuery({
    queryKey: ["fakturaer-legal-entities"],
    queryFn: async () => {
      // Hent posisjoner brukeren har, sammen med tilgang til fakturaer-app
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [] as LegalEntityRow[];

      // Strategi: hent alle legal_entities, RLS filtrerer ikke denne tabellen,
      // men vi bruker user_positions for å begrense til de brukeren har tilgang til.
      const { data: ups, error: upErr } = await supabase
        .from("user_positions")
        .select("legal_entity_id, position_id, positions!inner(is_owner)")
        .eq("user_id", user.id);
      if (upErr) throw upErr;

      const isOwner = (ups ?? []).some((up: any) => up.positions?.is_owner);

      const mapRow = (r: any): LegalEntityRow => ({ id: r.id, name: r.legal_name, short_code: r.short_code });

      if (isOwner) {
        const { data: all, error } = await supabase
          .from("legal_entities")
          .select("id, legal_name, short_code")
          .order("legal_name");
        if (error) throw error;
        return (all ?? []).map(mapRow);
      }

      const positionIds = Array.from(new Set((ups ?? []).map((up: any) => up.position_id)));
      if (positionIds.length === 0) return [];
      const { data: paa } = await supabase
        .from("position_app_access")
        .select("position_id, apps!inner(code)")
        .in("position_id", positionIds);
      const allowedPositions = new Set(
        (paa ?? []).filter((row: any) => row.apps?.code === APP_CODE).map((row: any) => row.position_id),
      );
      const entityIds = Array.from(
        new Set(
          (ups ?? [])
            .filter((up: any) => allowedPositions.has(up.position_id))
            .map((up: any) => up.legal_entity_id as string),
        ),
      );
      if (entityIds.length === 0) return [];
      const { data, error } = await supabase
        .from("legal_entities")
        .select("id, legal_name, short_code")
        .in("id", entityIds)
        .order("legal_name");
      if (error) throw error;
      return (data ?? []).map(mapRow);
    },
  });
}
