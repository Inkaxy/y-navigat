import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AccessLevel = "admin" | "write" | "read";

export type AccessibleApp = {
  id: string;
  slug: string;
  display_name: string;
  category: string;
  deploy_url: string;
  start_path: string;
  icon_name: string;
  sort_order: number;
  status: string;
  color_hex: string;
  access_level: AccessLevel;
};

export function useAccessibleApps() {
  return useQuery({
    queryKey: ["accessible-apps"],
    queryFn: async (): Promise<AccessibleApp[]> => {
      const { data, error } = await supabase.rpc("get_my_accessible_apps");
      if (error) throw error;
      return ((data ?? []) as unknown as AccessibleApp[]).sort(
        (a, b) => a.sort_order - b.sort_order,
      );
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function groupByCategory(
  apps: AccessibleApp[],
): Record<string, AccessibleApp[]> {
  const groups: Record<string, AccessibleApp[]> = {};
  apps.forEach((app) => {
    if (!groups[app.category]) groups[app.category] = [];
    groups[app.category].push(app);
  });
  return groups;
}

export const CATEGORY_LABELS: Record<string, string> = {
  platform: "Plattform",
  masterdata: "Stamdata",
  operations: "Drift",
  retail: "Butikk",
  finance: "Økonomi",
  analytics: "Analyse",
  hr: "HR",
  public: "Publikum",
  general: "Generelt",
};

export function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}
