import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { showError } from "@/lib/userError";
import { NBE_LEGAL_ENTITY_ID } from "@/rapporter/lib/constants";
import { logAudit } from "@/rapporter/lib/audit";

export type StatisticGroup = {
  id: string;
  display_name: string;
  description: string | null;
  sort_order: number;
  status: string;
  is_report_bound: boolean;
  member_count: number;
};

export type GroupMember = {
  product_id: string;
  display_number: number;
  display_name: string;
  category: string | null;
  group_count: number;
};

export type ProductOption = {
  id: string;
  display_number: number;
  display_name: string;
};

const GROUPS_KEY = ["rapporter", "statistic-groups"];

/** Vennlig melding når beskyttelsestriggeren eller unik-indeksen slår inn. */
function friendlyError(error: unknown, fallback: string): string {
  const msg = String((error as { message?: string })?.message ?? "");
  if (msg.includes("styrer en rapport") || msg.includes("rapportbindingen")) {
    return "Denne gruppen styrer NG-rapporten og kan ikke slettes eller arkiveres.";
  }
  if (msg.includes("duplicate key") || msg.includes("statistic_groups_legal_entity_id_display_name_key")) {
    return "Det finnes allerede en gruppe med dette navnet.";
  }
  return fallback;
}

export function useStatisticGroups(includeArchived: boolean) {
  return useQuery({
    queryKey: [...GROUPS_KEY, includeArchived],
    queryFn: async (): Promise<StatisticGroup[]> => {
      let q = supabase
        .from("statistic_groups")
        .select("id, display_name, description, sort_order, status, is_report_bound, statistic_group_members(count)")
        .eq("legal_entity_id", NBE_LEGAL_ENTITY_ID)
        .order("sort_order")
        .order("display_name");
      if (!includeArchived) q = q.eq("status", "active");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((g) => {
        const rel = (g as unknown as { statistic_group_members?: { count: number }[] })
          .statistic_group_members;
        return {
          id: g.id,
          display_name: g.display_name,
          description: g.description,
          sort_order: g.sort_order,
          status: g.status,
          is_report_bound: g.is_report_bound,
          member_count: rel?.[0]?.count ?? 0,
        };
      });
    },
  });
}

export function useGroupMembers(groupId: string | null) {
  return useQuery({
    queryKey: ["rapporter", "statistic-group-members", groupId],
    enabled: !!groupId,
    queryFn: async (): Promise<GroupMember[]> => {
      const { data, error } = await supabase
        .from("statistic_group_members")
        .select("product_id, products!inner(display_number, display_name, product_category)")
        .eq("group_id", groupId!);
      if (error) throw error;
      const rows = (data ?? []) as unknown as {
        product_id: string;
        products: { display_number: number; display_name: string; product_category: string | null };
      }[];
      const ids = rows.map((r) => r.product_id);

      // Hvor mange grupper står hver vare i? (for «flere grupper»-badge)
      const counts = new Map<string, number>();
      if (ids.length > 0) {
        const { data: all, error: cErr } = await supabase
          .from("statistic_group_members")
          .select("product_id")
          .in("product_id", ids);
        if (cErr) throw cErr;
        for (const r of all ?? []) {
          counts.set(r.product_id, (counts.get(r.product_id) ?? 0) + 1);
        }
      }

      return rows
        .map((r) => ({
          product_id: r.product_id,
          display_number: Number(r.products.display_number),
          display_name: r.products.display_name,
          category: r.products.product_category,
          group_count: counts.get(r.product_id) ?? 1,
        }))
        .sort((a, b) => a.display_number - b.display_number);
    },
  });
}

/** Aktive, selgbare varer som ikke allerede er medlem av gruppen. */
export function useAddableProducts(search: string, excludeIds: string[], enabled: boolean) {
  return useQuery({
    queryKey: ["rapporter", "addable-products", search],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<ProductOption[]> => {
      let q = supabase
        .from("products")
        .select("id, display_number, display_name")
        .eq("legal_entity_id", NBE_LEGAL_ENTITY_ID)
        .eq("is_for_sale", true)
        .neq("status", "discontinued")
        .order("display_number")
        .limit(200);
      const s = search.trim().replace(/[%,]/g, " ");
      if (s.length > 0) {
        const numeric = /^\d+$/.test(s);
        q = numeric
          ? q.or(`display_name.ilike.%${s}%,display_number.eq.${s}`)
          : q.ilike("display_name", `%${s}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((p) => ({
        id: p.id,
        display_number: Number(p.display_number),
        display_name: p.display_name,
      }));
    },
    select: (rows) => rows.filter((p) => !excludeIds.includes(p.id)),
  });
}

export function useGroupMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: GROUPS_KEY });
    qc.invalidateQueries({ queryKey: ["rapporter", "statistic-group-members"] });
  };

  const createGroup = useMutation({
    mutationFn: async (displayName: string) => {
      const { data, error } = await supabase
        .from("statistic_groups")
        .insert({ legal_entity_id: NBE_LEGAL_ENTITY_ID, display_name: displayName.trim() })
        .select("id, display_name")
        .single();
      if (error) throw error;
      await logAudit({
        action: "create",
        entity_type: "statistic_group",
        entity_id: data.id,
        entity_display_reference: data.display_name,
      });
      return data;
    },
    onSuccess: (g) => {
      toast.success(`Gruppen «${g.display_name}» er opprettet`);
      invalidate();
    },
    onError: (e) => showError("createGroup", e, friendlyError(e, "Kunne ikke opprette gruppen.")),
  });

  const updateGroup = useMutation({
    mutationFn: async (input: {
      id: string;
      display_name?: string;
      description?: string | null;
      status?: string;
    }) => {
      const { id, ...patch } = input;
      const { error } = await supabase.from("statistic_groups").update(patch).eq("id", id);
      if (error) throw error;
      await logAudit({
        action: patch.status === "archived" ? "archive" : "update",
        entity_type: "statistic_group",
        entity_id: id,
        entity_display_reference: patch.display_name ?? null,
        changes: patch as Record<string, unknown>,
      });
    },
    onSuccess: () => {
      toast.success("Gruppen er oppdatert");
      invalidate();
    },
    onError: (e) => showError("updateGroup", e, friendlyError(e, "Kunne ikke oppdatere gruppen.")),
  });

  const deleteGroup = useMutation({
    mutationFn: async (group: StatisticGroup) => {
      const { error } = await supabase.from("statistic_groups").delete().eq("id", group.id);
      if (error) throw error;
      await logAudit({
        action: "delete",
        entity_type: "statistic_group",
        entity_id: group.id,
        entity_display_reference: group.display_name,
      });
    },
    onSuccess: () => {
      toast.success("Gruppen er slettet");
      invalidate();
    },
    onError: (e) => showError("deleteGroup", e, friendlyError(e, "Kunne ikke slette gruppen.")),
  });

  const addMember = useMutation({
    mutationFn: async (input: { groupId: string; product: ProductOption }) => {
      const { error } = await supabase
        .from("statistic_group_members")
        .insert({ group_id: input.groupId, product_id: input.product.id });
      if (error) throw error;
      await logAudit({
        action: "member_added",
        entity_type: "statistic_group_member",
        entity_id: input.groupId,
        entity_display_reference: `${input.product.display_number} ${input.product.display_name}`,
      });
    },
    onSuccess: () => {
      toast.success("Varen er lagt til");
      invalidate();
    },
    onError: (e) => showError("addMember", e, "Kunne ikke legge til varen."),
  });

  const removeMember = useMutation({
    mutationFn: async (input: { groupId: string; member: GroupMember }) => {
      const { error } = await supabase
        .from("statistic_group_members")
        .delete()
        .eq("group_id", input.groupId)
        .eq("product_id", input.member.product_id);
      if (error) throw error;
      await logAudit({
        action: "member_removed",
        entity_type: "statistic_group_member",
        entity_id: input.groupId,
        entity_display_reference: `${input.member.display_number} ${input.member.display_name}`,
      });
    },
    onSuccess: () => {
      toast.success("Varen er fjernet");
      invalidate();
    },
    onError: (e) => showError("removeMember", e, "Kunne ikke fjerne varen."),
  });

  return { createGroup, updateGroup, deleteGroup, addMember, removeMember };
}
