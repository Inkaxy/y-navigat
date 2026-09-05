import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { osloTodayISO } from "@/lib/osloDate";

export type AccessInfo = {
  hasOrdreAccess: boolean;
  hasOrdreWrite: boolean;
  hasOrdreAdmin: boolean;
  hasNBPosition: boolean;
};

/** Sjekker brukerens tilgang til Ordre-appen og om de har stilling i Nøtterø Bakeri AS */
export function useUserAccess(user: User | null) {
  return useQuery({
    queryKey: ["ordre-access", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<AccessInfo> => {
      const today = osloTodayISO();

      const { data: positions, error: posErr } = await supabase
        .from("user_positions")
        .select("position_id, legal_entity_id, valid_from, valid_to")
        .eq("user_id", user!.id)
        .lte("valid_from", today);
      if (posErr) throw posErr;

      const active = (positions ?? []).filter((p) => !p.valid_to || p.valid_to >= today);
      const positionIds = active.map((p) => p.position_id);
      const hasNBPosition = active.some((p) => p.legal_entity_id === NB_LEGAL_ENTITY_ID);

      const { data: appRow } = await supabase
        .from("apps")
        .select("id")
        .eq("code", "ordre")
        .maybeSingle();

      let hasOrdreAccess = false;
      let hasOrdreWrite = false;
      let hasOrdreAdmin = false;

      if (appRow && positionIds.length) {
        const { data: access } = await supabase
          .from("position_app_access")
          .select("level")
          .in("position_id", positionIds)
          .eq("app_id", appRow.id);
        for (const a of access ?? []) {
          if (a.level && a.level !== "none") hasOrdreAccess = true;
          if (a.level === "write" || a.level === "approve" || a.level === "admin") hasOrdreWrite = true;
          if (a.level === "admin") hasOrdreAdmin = true;
        }
      }

      return { hasOrdreAccess, hasOrdreWrite, hasOrdreAdmin, hasNBPosition };
    },
    staleTime: 60_000,
  });
}
