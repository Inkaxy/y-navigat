import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/kunder/lib/audit";

export type CustomerGroup = {
  id: string;
  legal_entity_id: string;
  code: string;
  display_name: string;
  description: string | null;
  color_hex: string | null;
  default_price_list_id: string | null;
  sort_order: number;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type CustomerGroupWithCounts = CustomerGroup & {
  member_count: number;
  price_list_name: string | null;
};

/** Liste over kundegrupper med medlems-count og prisliste-navn. */
export function useCustomerGroups(legalEntityId: string | null | undefined) {
  return useQuery({
    queryKey: ["customer-groups", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<CustomerGroupWithCounts[]> => {
      const { data: groups, error } = await supabase
        .from("customer_groups" as any)
        .select("*")
        .eq("legal_entity_id", legalEntityId!)
        .order("sort_order", { ascending: true })
        .order("display_name", { ascending: true });
      if (error) throw error;
      const rows = (groups ?? []) as unknown as CustomerGroup[];
      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);
      const priceListIds = Array.from(
        new Set(rows.map((r) => r.default_price_list_id).filter(Boolean) as string[]),
      );

      const [memberRes, priceRes] = await Promise.all([
        supabase
          .from("customer_group_members" as any)
          .select("group_id")
          .in("group_id", ids),
        priceListIds.length
          ? supabase
              .from("price_lists")
              .select("id, display_name")
              .in("id", priceListIds)
          : Promise.resolve({ data: [], error: null } as any),
      ]);
      if (memberRes.error) throw memberRes.error;
      if ((priceRes as any).error) throw (priceRes as any).error;

      const counts: Record<string, number> = {};
      for (const m of ((memberRes.data ?? []) as any[])) {
        counts[m.group_id] = (counts[m.group_id] ?? 0) + 1;
      }
      const priceMap = new Map<string, string>();
      for (const p of ((priceRes as any).data ?? []) as any[]) {
        priceMap.set(p.id, p.display_name);
      }

      return rows.map((g) => ({
        ...g,
        member_count: counts[g.id] ?? 0,
        price_list_name: g.default_price_list_id
          ? priceMap.get(g.default_price_list_id) ?? null
          : null,
      }));
    },
  });
}

/** Medlemmer av en gruppe (kunder med basisinfo). */
export function useCustomerGroupMembers(groupId: string | null | undefined) {
  return useQuery({
    queryKey: ["customer-group-members", groupId],
    enabled: !!groupId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_group_members" as any)
        .select("customer_id, added_at")
        .eq("group_id", groupId!);
      if (error) throw error;
      const memberRows = (data ?? []) as any[];
      if (memberRows.length === 0) return [] as Array<{
        customer_id: string;
        display_name: string;
        customer_number: string | null;
        default_price_list_id: string | null;
      }>;
      const customerIds = memberRows.map((m) => m.customer_id);
      const { data: customers, error: cErr } = await supabase
        .from("customers")
        .select("id, display_name, customer_number, default_price_list_id")
        .in("id", customerIds);
      if (cErr) throw cErr;
      return ((customers ?? []) as any[]).map((c) => ({
        customer_id: c.id,
        display_name: c.display_name,
        customer_number: c.customer_number ?? null,
        default_price_list_id: c.default_price_list_id ?? null,
      }));
    },
  });
}

/** Gruppe-IDs som en kunde tilhører. */
export function useCustomerGroupMembership(customerId: string | null | undefined) {
  return useQuery({
    queryKey: ["customer-group-membership", customerId],
    enabled: !!customerId,
    queryFn: async (): Promise<CustomerGroup[]> => {
      const { data, error } = await supabase
        .from("customer_group_members" as any)
        .select("group_id")
        .eq("customer_id", customerId!);
      if (error) throw error;
      const ids = ((data ?? []) as any[]).map((m) => m.group_id);
      if (ids.length === 0) return [];
      const { data: groups, error: gErr } = await supabase
        .from("customer_groups" as any)
        .select("*")
        .in("id", ids);
      if (gErr) throw gErr;
      return ((groups ?? []) as unknown) as CustomerGroup[];
    },
  });
}

/** Map fra customer_id → group-rader, for liste-visning med badges. */
export function useCustomerGroupsByCustomer(legalEntityId: string | null | undefined) {
  return useQuery({
    queryKey: ["customer-groups-by-customer", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data: groups, error } = await supabase
        .from("customer_groups" as any)
        .select("id, display_name, color_hex, status")
        .eq("legal_entity_id", legalEntityId!);
      if (error) throw error;
      const groupRows = (groups ?? []) as any[];
      if (groupRows.length === 0) return {} as Record<string, Array<{ id: string; display_name: string; color_hex: string | null }>>;
      const groupMap = new Map<string, any>();
      for (const g of groupRows) groupMap.set(g.id, g);

      const { data: memberRows, error: mErr } = await supabase
        .from("customer_group_members" as any)
        .select("customer_id, group_id")
        .in("group_id", groupRows.map((g) => g.id));
      if (mErr) throw mErr;

      const result: Record<string, Array<{ id: string; display_name: string; color_hex: string | null }>> = {};
      for (const m of ((memberRows ?? []) as any[])) {
        const g = groupMap.get(m.group_id);
        if (!g) continue;
        if (!result[m.customer_id]) result[m.customer_id] = [];
        result[m.customer_id].push({ id: g.id, display_name: g.display_name, color_hex: g.color_hex ?? null });
      }
      return result;
    },
  });
}

type UpsertGroupInput = {
  id?: string;
  legal_entity_id: string;
  code: string;
  display_name: string;
  description?: string | null;
  color_hex?: string | null;
  default_price_list_id?: string | null;
  sort_order?: number;
  status?: "active" | "archived";
};

export function useUpsertCustomerGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertGroupInput) => {
      const isUpdate = !!input.id;
      const payload = {
        legal_entity_id: input.legal_entity_id,
        code: input.code,
        display_name: input.display_name,
        description: input.description ?? null,
        color_hex: input.color_hex ?? null,
        default_price_list_id: input.default_price_list_id ?? null,
        sort_order: input.sort_order ?? 0,
        status: input.status ?? "active",
      };
      if (isUpdate) {
        const { data, error } = await supabase
          .from("customer_groups" as any)
          .update(payload)
          .eq("id", input.id!)
          .select()
          .single();
        if (error) throw error;
        await logAudit({
          action: "customer_group.updated",
          entity_type: "customer_group",
          entity_id: input.id,
          entity_display_reference: `${payload.code} — ${payload.display_name}`,
          legal_entity_id: input.legal_entity_id,
          changes: payload,
        });
        return data;
      } else {
        const { data: userRes } = await supabase.auth.getUser();
        const { data, error } = await supabase
          .from("customer_groups" as any)
          .insert({ ...payload, created_by: userRes.user?.id ?? null })
          .select()
          .single();
        if (error) throw error;
        await logAudit({
          action: "customer_group.created",
          entity_type: "customer_group",
          entity_id: (data as any).id,
          entity_display_reference: `${payload.code} — ${payload.display_name}`,
          legal_entity_id: input.legal_entity_id,
          changes: payload,
        });
        return data;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["customer-groups", vars.legal_entity_id] });
      qc.invalidateQueries({ queryKey: ["customer-groups-by-customer", vars.legal_entity_id] });
      if (vars.id) {
        qc.invalidateQueries({ queryKey: ["customer-group-members", vars.id] });
      }
    },
  });
}

export function useDeleteCustomerGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; legal_entity_id: string; display_name: string; code: string }) => {
      const { error } = await supabase.from("customer_groups" as any).delete().eq("id", input.id);
      if (error) throw error;
      await logAudit({
        action: "customer_group.deleted",
        entity_type: "customer_group",
        entity_id: input.id,
        entity_display_reference: `${input.code} — ${input.display_name}`,
        legal_entity_id: input.legal_entity_id,
      });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["customer-groups", vars.legal_entity_id] });
      qc.invalidateQueries({ queryKey: ["customer-groups-by-customer", vars.legal_entity_id] });
    },
  });
}

/** Sync medlemmer til en gruppe — diff add/remove. */
export function useSetGroupMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      group_id: string;
      legal_entity_id: string;
      group_label: string;
      next_customer_ids: string[];
    }) => {
      const { data: existing, error } = await supabase
        .from("customer_group_members" as any)
        .select("customer_id")
        .eq("group_id", input.group_id);
      if (error) throw error;
      const have = new Set(((existing ?? []) as any[]).map((r) => r.customer_id as string));
      const next = new Set(input.next_customer_ids);
      const toAdd = [...next].filter((id) => !have.has(id));
      const toRemove = [...have].filter((id) => !next.has(id));

      if (toAdd.length > 0) {
        const { data: userRes } = await supabase.auth.getUser();
        const rows = toAdd.map((customer_id) => ({
          customer_id,
          group_id: input.group_id,
          added_by: userRes.user?.id ?? null,
        }));
        const { error: addErr } = await supabase.from("customer_group_members" as any).insert(rows);
        if (addErr) throw addErr;
      }
      if (toRemove.length > 0) {
        const { error: rmErr } = await supabase
          .from("customer_group_members" as any)
          .delete()
          .eq("group_id", input.group_id)
          .in("customer_id", toRemove);
        if (rmErr) throw rmErr;
      }
      if (toAdd.length || toRemove.length) {
        await logAudit({
          action: "customer_group.members_changed",
          entity_type: "customer_group",
          entity_id: input.group_id,
          entity_display_reference: input.group_label,
          legal_entity_id: input.legal_entity_id,
          changes: { added: toAdd, removed: toRemove },
        });
      }
      return { added: toAdd.length, removed: toRemove.length };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["customer-group-members", vars.group_id] });
      qc.invalidateQueries({ queryKey: ["customer-groups", vars.legal_entity_id] });
      qc.invalidateQueries({ queryKey: ["customer-groups-by-customer", vars.legal_entity_id] });
      qc.invalidateQueries({ queryKey: ["customer-group-membership"] });
    },
  });
}

/** Effektiv prisliste for en kunde (kundens egen → gruppens default → null). */
export function useCustomerEffectivePriceList(customerId: string | null | undefined) {
  return useQuery({
    queryKey: ["customer-effective-price-list", customerId],
    enabled: !!customerId,
    queryFn: async (): Promise<{ price_list_id: string | null; price_list_name: string | null; source: "customer" | "group" | "none" }> => {
      const { data, error } = await supabase.rpc("customer_effective_price_list" as any, { _customer_id: customerId });
      if (error) throw error;
      const priceListId = (data as string | null) ?? null;
      if (!priceListId) return { price_list_id: null, price_list_name: null, source: "none" };

      const { data: customer } = await supabase
        .from("customers")
        .select("default_price_list_id")
        .eq("id", customerId!)
        .maybeSingle();
      const source: "customer" | "group" =
        customer?.default_price_list_id === priceListId ? "customer" : "group";

      const { data: pl } = await supabase
        .from("price_lists")
        .select("display_name")
        .eq("id", priceListId)
        .maybeSingle();
      return {
        price_list_id: priceListId,
        price_list_name: pl?.display_name ?? null,
        source,
      };
    },
  });
}
