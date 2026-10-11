import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";
import { caseSums, type CaseSums } from "./caseLogic";
import { caseKindOf, type DraftKind } from "@/fakturaer/lib/supplierCaseDraft";

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
  /** Fra saklinjenes låste grunnlag; null = eldre/blandet sak. */
  kind: DraftKind;
};

const ZERO: CaseSums = { krav: 0, kreditert: 0, gjenstar: 0 };

/** Høyst så mange saker hentes; flere vises som «Viser N av M». */
export const CASE_LIST_LIMIT = 300;

export type CaseListResult = { rows: CaseListRow[]; total: number };

/** Sakene med summer: én spørring for sakene, og sakslinjer/fordelinger side for side (ikke kuttet ved 1000). */
export function useSupplierCaseList(legalEntityId: string | null) {
  return useQuery({
    queryKey: ["supplier-cases", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<CaseListResult> => {
      const { data, error, count } = await supabase
        .from("supplier_deviation_cases")
        .select("id, title, status, supplier_id, responsible_user_id, follow_up_on, created_at, supplier:suppliers(name)", { count: "exact" })
        .eq("legal_entity_id", legalEntityId as string)
        .order("created_at", { ascending: false })
        .limit(CASE_LIST_LIMIT);
      if (error) throw error;
      const cases = data ?? [];
      const ids = cases.map((c) => c.id);
      if (ids.length === 0) return { rows: [], total: count ?? 0 };
      const [lines, credits] = await Promise.all([
        fetchAllRows((from, to) => supabase.from("supplier_deviation_case_lines").select("id, case_id, amount_excl_vat, case_kind:basis->>case_kind").in("case_id", ids).order("id").range(from, to)),
        fetchAllRows((from, to) => supabase.from("supplier_deviation_credits").select("id, case_id, amount_excl_vat").in("case_id", ids).order("id").range(from, to)),
      ]);
      const sums = caseSums(lines, credits);
      const kinds = new Map<string, (string | null)[]>();
      for (const l of lines) kinds.set(l.case_id, [...(kinds.get(l.case_id) ?? []), typeof l.case_kind === "string" ? l.case_kind : null]);
      const rows = cases.map((c) => ({
        id: c.id, title: c.title, status: c.status, supplier_id: c.supplier_id, supplier_name: c.supplier?.name ?? null,
        responsible_user_id: c.responsible_user_id, follow_up_on: c.follow_up_on, created_at: c.created_at,
        sums: sums.get(c.id) ?? ZERO, kind: caseKindOf(kinds.get(c.id) ?? []),
      }));
      return { rows, total: count ?? rows.length };
    },
  });
}
