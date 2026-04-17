import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export function useMyPositions() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["my-positions", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_positions")
        .select(`
          id,
          is_primary,
          outlet_scope,
          outlet_ids,
          valid_from,
          valid_to,
          position:positions ( id, code, display_name, category ),
          legal_entity:legal_entities ( id, short_code, legal_name, signature_color )
        `)
        .eq("user_id", user!.id)
        .order("is_primary", { ascending: false });
      if (error) throw error;

      // Hent outlet-navn for spesifikke scopes
      const allOutletIds = Array.from(
        new Set((data ?? []).flatMap((p: any) => p.outlet_ids ?? [])),
      );

      let outletMap: Record<string, { id: string; short_name: string; full_name: string | null }> = {};
      if (allOutletIds.length > 0) {
        const { data: outlets } = await supabase
          .from("outlets")
          .select("id, short_name, full_name")
          .in("id", allOutletIds);
        outletMap = Object.fromEntries((outlets ?? []).map((o) => [o.id, o]));
      }

      return (data ?? []).map((p: any) => ({
        ...p,
        outlets: (p.outlet_ids ?? []).map((id: string) => outletMap[id]).filter(Boolean),
      }));
    },
  });
}
