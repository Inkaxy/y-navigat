import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TicketSubscription {
  id: string;
  microsoft_subscription_id: string;
  resource: string;
  expiration_date_time: string;
  last_renewed_at: string | null;
  created_at: string;
}

export function useTicketSubscriptions() {
  return useQuery({
    queryKey: ["ticket-subscriptions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_subscriptions")
        .select("id, microsoft_subscription_id, resource, expiration_date_time, last_renewed_at, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TicketSubscription[];
    },
  });
}

export function useCreateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-graph-subscription-create");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ticket-subscriptions"] }),
  });
}

export function useDeleteSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (subscription_id?: string) => {
      const { data, error } = await supabase.functions.invoke("microsoft-graph-subscription-delete", {
        body: subscription_id ? { subscription_id } : {},
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ticket-subscriptions"] }),
  });
}
