import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DepartmentLabelStats {
  todayCount: number;
  weekCount: number;
  lastJob: {
    label_number: string;
    printed_at: string;
    product_display_name: string | null;
  } | null;
}

/**
 * Returns "today" boundary as ISO timestamp at 00:00 Europe/Oslo, expressed in UTC.
 * Postgres comparison is timestamptz-safe.
 */
function osloMidnightUtcIso(): string {
  // Get current Oslo date parts using Intl
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  // Oslo is UTC+1 (winter) or UTC+2 (summer). Build a Date for local Oslo midnight
  // by trying both offsets and picking the one whose Oslo-rendered date matches.
  for (const offsetH of [1, 2]) {
    const candidate = new Date(`${y}-${m}-${d}T00:00:00${offsetH === 1 ? "+01:00" : "+02:00"}`);
    const renderedY = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Oslo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(candidate);
    if (renderedY === `${y}-${m}-${d}`) return candidate.toISOString();
  }
  // Fallback
  return new Date(`${y}-${m}-${d}T00:00:00+01:00`).toISOString();
}

export const departmentStatsKey = (deptId: string) =>
  ["oversikt", "department-stats", deptId] as const;

export function useDepartmentLabelStats(deptId: string | undefined) {
  return useQuery({
    queryKey: departmentStatsKey(deptId ?? "none"),
    enabled: !!deptId,
    queryFn: async (): Promise<DepartmentLabelStats> => {
      const todayIso = osloMidnightUtcIso();
      const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [todayRes, weekRes, lastRes] = await Promise.all([
        supabase
          .from("label_print_jobs")
          .select("id", { count: "exact", head: true })
          .eq("production_department_id", deptId!)
          .gte("printed_at", todayIso),
        supabase
          .from("label_print_jobs")
          .select("id", { count: "exact", head: true })
          .eq("production_department_id", deptId!)
          .gte("printed_at", weekAgoIso),
        supabase
          .from("label_print_jobs")
          .select(
            "label_number, printed_at, product:products!label_print_jobs_product_id_fkey(display_name)",
          )
          .eq("production_department_id", deptId!)
          .order("printed_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (todayRes.error) throw todayRes.error;
      if (weekRes.error) throw weekRes.error;
      if (lastRes.error) throw lastRes.error;

      const lastRow = lastRes.data as
        | { label_number: string; printed_at: string; product: { display_name: string } | null }
        | null;

      return {
        todayCount: todayRes.count ?? 0,
        weekCount: weekRes.count ?? 0,
        lastJob: lastRow
          ? {
              label_number: lastRow.label_number,
              printed_at: lastRow.printed_at,
              product_display_name: lastRow.product?.display_name ?? null,
            }
          : null,
      };
    },
  });
}

/**
 * Subscribes to label_print_jobs for the given legal_entity and invalidates
 * stats for ALL given department ids whenever a relevant row changes.
 */
export function useOversiktRealtime(
  legalEntityId: string | undefined,
  departmentIds: string[],
) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!legalEntityId || departmentIds.length === 0) return;
    const channel = supabase
      .channel(`oversikt-${legalEntityId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "label_print_jobs",
          filter: `legal_entity_id=eq.${legalEntityId}`,
        },
        (payload) => {
          const row =
            (payload.new as { production_department_id?: string } | null) ??
            (payload.old as { production_department_id?: string } | null);
          const deptId = row?.production_department_id;
          if (deptId && departmentIds.includes(deptId)) {
            qc.invalidateQueries({ queryKey: departmentStatsKey(deptId) });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [legalEntityId, departmentIds.join(","), qc]);
}
