import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { caseSums, type CaseSums } from "./caseLogic";

export type CaseListRow = {
  id: string;
  title: string;
  status: string;
  supplier_id: string;
  supplier_name: string | null;
  responsible_user_id: string | null;
  follow_up_on: string | null;
  created_at: string;
  sums: CaseSums;
};

const ZERO: CaseSums = { krav: 0, kreditert: 0, gjenstar: 0 };

/** Sakene med summer: én spørring for sakene, én for alle sakslinjer og én for alle fordelinger. */
export function useSupplierCaseList(legalEntityId: string | null) {
  return useQuery({
    queryKey: ["supplier-cases", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<CaseListRow[]> => {
      const { data, error } = await supabase
        .from("supplier_deviation_cases")
        .select("id, title, status, supplier_id, responsible_user_id, follow_up_on, created_at, supplier:suppliers(name)")
        .eq("legal_entity_id", legalEntityId as string)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      const cases = data ?? [];
      const ids = cases.map((c) => c.id);
      if (ids.length === 0) return [];
      const [lines, credits] = await Promise.all([
        supabase.from("supplier_deviation_case_lines").select("case_id, amount_excl_vat").in("case_id", ids).limit(10000),
        supabase.from("supplier_deviation_credits").select("case_id, amount_excl_vat").in("case_id", ids).limit(10000),
      ]);
      if (lines.error) throw lines.error;
      if (credits.error) throw credits.error;
      const sums = caseSums(lines.data ?? [], credits.data ?? []);
      return cases.map((c) => ({
        id: c.id, title: c.title, status: c.status, supplier_id: c.supplier_id, supplier_name: c.supplier?.name ?? null,
        responsible_user_id: c.responsible_user_id, follow_up_on: c.follow_up_on, created_at: c.created_at,
        sums: sums.get(c.id) ?? ZERO,
      }));
    },
  });
}
