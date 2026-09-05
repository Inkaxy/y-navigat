import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CAKE_BUCKET } from "@/ordre/lib/cakeImages";

export type LabelUnitCakeImage = {
  id: string;
  label_unit_id: string;
  thumb_url: string | null;
};

export function useLabelUnitCakeImages(labelUnitIds: string[]) {
  const ids = useMemo(
    () => Array.from(new Set(labelUnitIds)).sort(),
    [labelUnitIds],
  );

  return useQuery({
    enabled: ids.length > 0,
    queryKey: ["label-unit-cake-images", ids.join(",")],
    queryFn: async (): Promise<Record<string, LabelUnitCakeImage>> => {
      const { data, error } = await supabase
        .from("cake_images")
        .select("id, label_unit_id, edited_path, original_path")
        .in("label_unit_id", ids);
      if (error) throw error;

      const rows = (data ?? []) as Array<{
        id: string;
        label_unit_id: string | null;
        edited_path: string | null;
        original_path: string;
      }>;
      const paths = rows
        .map((row) => row.edited_path || row.original_path)
        .filter(Boolean);
      const { data: signed, error: signedError } = paths.length
        ? await supabase.storage.from(CAKE_BUCKET).createSignedUrls(paths, 60 * 10)
        : { data: [], error: null };
      if (signedError) throw signedError;
      const urls = Object.fromEntries(
        (signed ?? []).map((item) => [item.path, item.signedUrl]),
      );

      const result: Record<string, LabelUnitCakeImage> = {};
      for (const row of rows) {
        if (!row.label_unit_id) continue;
        const path = row.edited_path || row.original_path;
        result[row.label_unit_id] = {
          id: row.id,
          label_unit_id: row.label_unit_id,
          thumb_url: urls[path] ?? null,
        };
      }
      return result;
    },
  });
}