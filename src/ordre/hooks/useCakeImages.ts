import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import {
  CAKE_BUCKET,
  type CakeImage,
  type CakeImageStatus,
} from "@/ordre/lib/cakeImages";

/** Liste for en dato + status-bucket ('for-utskrift' = venter + ferdig_redigert) */
export function useCakeImageList(
  date: string,
  bucket: "for-utskrift" | "skrevet-ut",
) {
  const qc = useQueryClient();
  const queryKey = ["cake-images", "list", date, bucket];

  const q = useQuery({
    queryKey,
    queryFn: async () => {
      const statuses: CakeImageStatus[] =
        bucket === "skrevet-ut"
          ? ["skrevet_ut"]
          : ["venter", "ferdig_redigert"];
      const { data, error } = await supabase
        .from("cake_images")
        .select("*")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("delivery_date", date)
        .in("status", statuses)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CakeImage[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel(`cake-images-${date}-${bucket}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cake_images",
          filter: `legal_entity_id=eq.${NB_LEGAL_ENTITY_ID}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["cake-images"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [date, bucket, qc]);

  return q;
}

export function useCakeImageCounts(date: string) {
  return useQuery({
    queryKey: ["cake-images", "counts", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cake_images")
        .select("status")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("delivery_date", date);
      if (error) throw error;
      let forUtskrift = 0;
      let skrevetUt = 0;
      for (const r of data ?? []) {
        if (r.status === "skrevet_ut") skrevetUt++;
        else forUtskrift++;
      }
      return { forUtskrift, skrevetUt };
    },
    refetchInterval: 15000,
  });
}

export function useCakeImage(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ["cake-image", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cake_images")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as CakeImage;
    },
  });
}

/** Memoiserte signed URLs for et sett med stier. */
export function useSignedUrls(paths: (string | null | undefined)[]) {
  const key = useMemo(() => paths.filter(Boolean).sort().join("|"), [paths]);
  const [map, setMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const list = paths.filter(Boolean) as string[];
    if (list.length === 0) {
      setMap({});
      return;
    }
    supabase.storage
      .from(CAKE_BUCKET)
      .createSignedUrls(list, 60 * 10)
      .then(({ data }) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const it of data ?? []) {
          if (it.path && it.signedUrl) next[it.path] = it.signedUrl;
        }
        setMap(next);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return map;
}
