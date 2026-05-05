import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Henter label_profile_id for et sett av produkter.
 * Returnerer Map<product_id, label_profile_id | null>.
 */
export function useProductLabelProfiles(productIds: string[] | undefined) {
  const qc = useQueryClient();
  const ids = (productIds ?? []).slice().sort();
  const key = ["product_label_profiles", ids.join(",")] as const;

  const query = useQuery({
    queryKey: key,
    enabled: ids.length > 0,
    queryFn: async (): Promise<Record<string, string | null>> => {
      const { data, error } = await supabase
        .from("products")
        .select("id, label_profile_id")
        .in("id", ids);
      if (error) throw error;
      const map: Record<string, string | null> = {};
      for (const id of ids) map[id] = null;
      for (const row of data ?? []) {
        map[row.id as string] = (row as { label_profile_id: string | null })
          .label_profile_id;
      }
      return map;
    },
  });

  // Realtime: invalidate hvis label_profile_id endres for et av produktene
  useEffect(() => {
    if (ids.length === 0) return;
    const channel = supabase
      .channel(`product-label-profiles:${ids.length}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "products",
        },
        (payload) => {
          const row = payload.new as { id?: string } | undefined;
          if (row?.id && ids.includes(row.id)) {
            qc.invalidateQueries({ queryKey: key });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  return query;
}

interface UpdateInput {
  productId: string;
  profileId: string | null;
  productLegalEntityId: string;
}

export function useUpdateProductLabelProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateInput) => {
      // App-lag-validering: profilen må tilhøre samme legal_entity som produktet
      if (input.profileId) {
        const { data: profile, error: pErr } = await supabase
          .from("label_print_profiles")
          .select("id, legal_entity_id, status")
          .eq("id", input.profileId)
          .single();
        if (pErr) throw pErr;
        if (!profile) throw new Error("Profilen finnes ikke");
        if (profile.legal_entity_id !== input.productLegalEntityId) {
          throw new Error(
            "Profilen tilhører et annet selskap enn varen. Velg en profil for samme selskap.",
          );
        }
        if (profile.status !== "active") {
          throw new Error("Profilen er arkivert. Velg en aktiv profil.");
        }
      }

      const { data, error } = await supabase
        .from("products")
        .update({ label_profile_id: input.profileId })
        .eq("id", input.productId)
        .select("id, label_profile_id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product_label_profiles"] });
    },
  });
}
