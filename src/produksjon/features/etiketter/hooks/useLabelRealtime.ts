import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { labelProductsQueryKey } from "./useLabelProducts";
import type { LabelScreenFilter } from "../types";

export type RealtimeStatus = "connecting" | "live" | "polling";

const DEBOUNCE_MS = 500;
const POLL_INTERVAL_MS = 30_000;

export function useLabelRealtime(filter: LabelScreenFilter | null): {
  status: RealtimeStatus;
  lastUpdateAt: number | null;
} {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!filter) return;

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: labelProductsQueryKey(filter) });
      setLastUpdateAt(Date.now());
    };

    const scheduleInvalidate = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(invalidate, DEBOUNCE_MS);
    };

    const startPolling = () => {
      if (pollRef.current) return;
      setStatus("polling");
      pollRef.current = setInterval(invalidate, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    const channel = supabase
      .channel(`${filter.legalEntityId}:labels:${filter.date}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_lines" },
        scheduleInvalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        scheduleInvalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        scheduleInvalidate,
      )
      .subscribe((subStatus) => {
        if (subStatus === "SUBSCRIBED") {
          stopPolling();
          setStatus("live");
        } else if (
          subStatus === "CHANNEL_ERROR" ||
          subStatus === "TIMED_OUT" ||
          subStatus === "CLOSED"
        ) {
          startPolling();
        }
      });

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      stopPolling();
      supabase.removeChannel(channel);
    };
  }, [filter, queryClient]);

  return { status, lastUpdateAt };
}
