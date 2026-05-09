import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Per-bruker UI-preferanse lagret i `user_ui_preferences` (Supabase).
 * Faller tilbake til localStorage for raskt initial-load uten flicker.
 */
export function useUiPreference<T>(scope: string, fallback: T) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const lsKey = `ui-pref:${scope}`;

  const [optimistic, setOptimistic] = useState<T | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(lsKey);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  });

  const query = useQuery({
    queryKey: ["ui-pref", scope, userId],
    enabled: !!userId,
    staleTime: Infinity,
    queryFn: async (): Promise<T> => {
      const { data, error } = await supabase
        .from("user_ui_preferences")
        .select("value")
        .eq("user_id", userId!)
        .eq("scope", scope)
        .maybeSingle();
      if (error) throw error;
      const v = (data?.value as T | undefined) ?? fallback;
      try {
        localStorage.setItem(lsKey, JSON.stringify(v));
      } catch {
        /* ignore */
      }
      return v;
    },
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setValue = useCallback(
    (next: T) => {
      setOptimistic(next);
      try {
        localStorage.setItem(lsKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      queryClient.setQueryData(["ui-pref", scope, userId], next);
      if (!userId) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        await supabase
          .from("user_ui_preferences")
          .upsert(
            { user_id: userId, scope, value: next as unknown as object },
            { onConflict: "user_id,scope" },
          );
      }, 300);
    },
    [lsKey, queryClient, scope, userId],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const value = (query.data ?? optimistic ?? fallback) as T;
  return { value, setValue, isLoading: query.isLoading };
}
