import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { osloTodayISO } from "@/lib/osloDate";

export type LegalEntity = {
  id: string;
  legal_name: string;
  short_code: string;
  status: string;
};

export type UserPositionRow = {
  id: string;
  legal_entity_id: string;
  position_id: string;
  is_primary: boolean | null;
  valid_from: string;
  valid_to: string | null;
  positions: {
    code: string;
    display_name: string;
    scope_pattern: string;
  } | null;
};

/** Henter brukerens aktive stillinger + tilknyttede selskaper. */
export function useUserAccess(user: User | null) {
  return useQuery({
    queryKey: ["user-access", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const today = osloTodayISO();

      const { data: positions, error: posErr } = await supabase
        .from("user_positions")
        .select(
          `id, legal_entity_id, position_id, is_primary, valid_from, valid_to,
           positions:position_id ( code, display_name, scope_pattern )`,
        )
        .eq("user_id", user!.id)
        .lte("valid_from", today);
      if (posErr) throw posErr;

      const activePositions = (positions ?? []).filter(
        (p: any) => !p.valid_to || p.valid_to >= today,
      ) as UserPositionRow[];

      const entityIds = Array.from(new Set(activePositions.map((p) => p.legal_entity_id)));

      let entities: LegalEntity[] = [];
      if (entityIds.length) {
        const { data: ents, error: entErr } = await supabase
          .from("legal_entities")
          .select("id, legal_name, short_code, status")
          .in("id", entityIds)
          .eq("status", "active")
          .order("short_code");
        if (entErr) throw entErr;
        entities = (ents ?? []) as LegalEntity[];
      }

      const hasCrossCompany = activePositions.some(
        (p) => p.positions?.scope_pattern === "all_companies",
      );

      // Sjekk app-tilgang for "kunder"
      const { data: appRow } = await supabase
        .from("apps")
        .select("id")
        .eq("code", "kunder")
        .maybeSingle();

      let hasKunderAccess = false;
      let hasKunderWrite = false;
      if (appRow) {
        const positionIds = activePositions.map((p) => p.position_id);
        if (positionIds.length) {
          const { data: access } = await supabase
            .from("position_app_access")
            .select("level")
            .in("position_id", positionIds)
            .eq("app_id", appRow.id);
          for (const a of access ?? []) {
            if (a.level && a.level !== "none") hasKunderAccess = true;
            if (a.level === "write" || a.level === "admin") hasKunderWrite = true;
          }
        }
      }

      // Primær-AS
      const primary = activePositions.find((p) => p.is_primary) ?? activePositions[0];
      const primaryEntityId = primary?.legal_entity_id ?? null;

      return {
        positions: activePositions,
        entities,
        hasCrossCompany,
        hasKunderAccess,
        hasKunderWrite,
        primaryEntityId,
      };
    },
    staleTime: 60_000,
  });
}
