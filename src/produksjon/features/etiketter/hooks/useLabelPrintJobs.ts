import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface LabelPrintJob {
  id: string;
  label_number: string;
  product_id: string;
  order_line_id: string | null;
  legal_entity_id: string;
  production_department_id: string;
  profile_id: string | null;
  quantity: number;
  printer_name: string | null;
  printed_by: string;
  printed_at: string;
  status: "printed" | "failed" | "reprinted";
  product?: { display_name: string; display_number: number } | null;
}

export const recentLabelJobsKey = (deptId: string | undefined) =>
  ["label_print_jobs", "recent", deptId ?? "none"] as const;

export function useRecentLabelJobs(
  deptId: string | undefined,
  legalEntityId: string | undefined,
  limit = 20,
) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!deptId || !legalEntityId) return;
    const channel = supabase
      .channel(`${legalEntityId}:label-jobs:${deptId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "label_print_jobs",
          filter: `production_department_id=eq.${deptId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: recentLabelJobsKey(deptId) });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [deptId, legalEntityId, qc]);

  return useQuery({
    queryKey: recentLabelJobsKey(deptId),
    enabled: !!deptId,
    queryFn: async (): Promise<LabelPrintJob[]> => {
      const { data, error } = await supabase
        .from("label_print_jobs")
        .select(
          "id, label_number, product_id, order_line_id, legal_entity_id, production_department_id, quantity, printer_name, printed_by, printed_at, status, product:products!label_print_jobs_product_id_fkey(display_name, display_number)",
        )
        .eq("production_department_id", deptId!)
        .order("printed_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as LabelPrintJob[];
    },
  });
}

export function useNextLabelNumber() {
  return useMutation({
    mutationFn: async (deptId: string): Promise<string> => {
      const { data, error } = await supabase.rpc("next_label_number", {
        p_dept_id: deptId,
      });
      if (error) throw error;
      return data as string;
    },
  });
}

export interface InsertLabelJobInput {
  label_number: string;
  product_id: string;
  order_line_id?: string | null;
  legal_entity_id: string;
  production_department_id: string;
  profile_id?: string | null;
  quantity: number;
  printer_name?: string | null;
  status?: "printed" | "failed" | "reprinted";
}

export function useInsertLabelPrintJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: InsertLabelJobInput) => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Ikke innlogget");

      const { data, error } = await supabase
        .from("label_print_jobs")
        .insert({
          label_number: input.label_number,
          product_id: input.product_id,
          order_line_id: input.order_line_id ?? null,
          legal_entity_id: input.legal_entity_id,
          production_department_id: input.production_department_id,
          profile_id: input.profile_id ?? null,
          quantity: input.quantity,
          printer_name: input.printer_name ?? null,
          printed_by: uid,
          status: input.status ?? "printed",
        })
        .select()
        .single();
      if (error) throw error;
      return data as LabelPrintJob;
    },
    onSuccess: (job) => {
      qc.invalidateQueries({
        queryKey: recentLabelJobsKey(job.production_department_id),
      });
    },
  });
}
