import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AssignableUser {
  id: string;
  display_name: string;
}

export function useAssignableUsers() {
  return useQuery({
    queryKey: ["assignable-users-ordre"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users_public")
        .select("id, display_name, status")
        .eq("status", "active")
        .order("display_name");
      if (error) throw error;
      return (data ?? []).map((u) => ({
        id: u.id,
        display_name: u.display_name ?? "(uten navn)",
      })) as AssignableUser[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
