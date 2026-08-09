import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import type { CakeImageFormat } from "@/ordre/lib/cakeFormats";

/** Aktive kakebilde-formater for selskapet, sortert. */
export function useCakeFormats() {
  return useQuery({
    queryKey: ["cake-image-formats", NB_LEGAL_ENTITY_ID],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cake_image_formats")
        .select("*")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CakeImageFormat[];
    },
  });
}

export function defaultFormat(formats: CakeImageFormat[] | undefined) {
  if (!formats || formats.length === 0) return null;
  return formats.find((f) => f.is_default) ?? formats[0];
}
