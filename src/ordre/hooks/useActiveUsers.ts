import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ActiveUser {
  id: string;
  display_name: string;
  email: string;
}

export function useActiveUsers() {
  return useQuery({
    queryKey: ["active-users-basic"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id, display_name, email, status")
        .eq("status", "active")
        .order("display_name");
      if (error) throw error;
      return ((data ?? []) as Array<ActiveUser & { status: string }>).map((u) => ({
        id: u.id,
        display_name: u.display_name,
        email: u.email,
      }));
    },
  });
}
