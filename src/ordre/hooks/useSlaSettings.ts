import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_SLA,
  DEFAULT_BUSINESS_HOURS,
  type SlaDeadlines,
  type BusinessHours,
} from "@/ordre/lib/sla";

export function useSlaSettings() {
  return useQuery({
    queryKey: ["ordre-sla-settings"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("platform_settings")
        .select("key,value")
        .eq("category", "ordre_ai")
        .in("key", ["sla_deadlines", "business_hours"]);
      const map = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
      const sla: SlaDeadlines = { ...DEFAULT_SLA, ...(map.sla_deadlines ?? {}) };
      const bh: BusinessHours = { ...DEFAULT_BUSINESS_HOURS, ...(map.business_hours ?? {}) };
      return { sla, bh };
    },
  });
}

export function useSaveSlaSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sla: SlaDeadlines; bh: BusinessHours }) => {
      const rows = [
        { category: "ordre_ai", key: "sla_deadlines", value: input.sla },
        { category: "ordre_ai", key: "business_hours", value: input.bh },
      ];
      for (const r of rows) {
        const { error } = await supabase
          .from("platform_settings")
          .upsert(r as never, { onConflict: "category,key" });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ordre-sla-settings"] }),
  });
}
