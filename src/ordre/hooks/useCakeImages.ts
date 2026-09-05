import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import {
  CAKE_BUCKET,
  type CakeImage,
  type CakeImageStatus,
} from "@/ordre/lib/cakeImages";
import { withResolvedLabelNumbers } from "@/ordre/lib/labelNumber";

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
      return withResolvedLabelNumbers((data ?? []) as CakeImage[]);
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

export type CakeImageCounts = {
  venter: number;
  ferdig: number;
  skrevetUt: number;
  manglerKobling: number;
  lavKvalitet: number;
  forUtskrift: number;
  total: number;
};

/** Dagsoversikt: hva venter, hva er klart, og hva stopper oss. */
export function useCakeImageCounts(date: string) {
  return useQuery({
    queryKey: ["cake-images", "counts", date],
    queryFn: async (): Promise<CakeImageCounts> => {
      const { data, error } = await supabase
        .from("cake_images")
        .select("status, order_id, quality_flag, quality_ack_at")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("delivery_date", date);
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        status: CakeImageStatus;
        order_id: string | null;
        quality_flag: string | null;
        quality_ack_at: string | null;
      }>;
      const c: CakeImageCounts = {
        venter: 0,
        ferdig: 0,
        skrevetUt: 0,
        manglerKobling: 0,
        lavKvalitet: 0,
        forUtskrift: 0,
        total: rows.length,
      };
      for (const r of rows) {
        if (r.status === "skrevet_ut") c.skrevetUt++;
        else if (r.status === "ferdig_redigert") c.ferdig++;
        else c.venter++;
        if (r.status !== "skrevet_ut") c.forUtskrift++;
        if (!r.order_id) c.manglerKobling++;
        if (r.quality_flag === "lav" && !r.quality_ack_at) c.lavKvalitet++;
      }
      return c;
    },
    refetchInterval: 15000,
  });
}

export type CakeOrderMeta = {
  order_id: string;
  order_number: string | null;
  customer_name: string | null;
  delivery_tour_id: string | null;
  tour_name: string | null;
  delivery_time: string | null;
};

/** Ordredetaljer for bildene i køen — tur, ordrenummer og kunde. */
export function useCakeOrderMeta(orderIds: (string | null | undefined)[]) {
  const ids = useMemo(
    () => Array.from(new Set(orderIds.filter(Boolean) as string[])).sort(),
    [orderIds],
  );
  return useQuery({
    enabled: ids.length > 0,
    queryKey: ["cake-images", "order-meta", ids.join(",")],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_number, delivery_tour_id, delivery_time, customers(name), delivery_tours(name)",
        )
        .in("id", ids);
      if (error) throw error;
      const map: Record<string, CakeOrderMeta> = {};
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        map[row.id as string] = {
          order_id: row.id as string,
          order_number: (row.order_number as string) ?? null,
          customer_name:
            ((row.customers as { name?: string } | null)?.name as string) ?? null,
          delivery_tour_id: (row.delivery_tour_id as string) ?? null,
          tour_name:
            ((row.delivery_tours as { name?: string } | null)?.name as string) ?? null,
          delivery_time: (row.delivery_time as string) ?? null,
        };
      }
      return map;
    },
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
