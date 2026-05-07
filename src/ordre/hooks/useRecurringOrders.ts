import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/lib/constants";

export type RecurringSchedule = {
  id: string;
  customer_id: string;
  legal_entity_id: string;
  name: string;
  is_active: boolean;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type RecurringScheduleWithCustomer = RecurringSchedule & {
  customer_display_name: string;
  customer_number: string;
  item_count: number;
};

export type RecurringItem = {
  id: string;
  schedule_id: string;
  product_id: string;
  weekday: number; // 1-7, ISO
  tour_id: string | null;
  quantity: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type RecurringScheduleFilter = {
  search?: string;
  status?: "active" | "inactive" | "all";
};

/** Liste over fastordre-maler m/ kunde-info + linjeantall. */
export function useRecurringSchedules(filter: RecurringScheduleFilter = {}) {
  return useQuery({
    queryKey: ["recurring-schedules", filter],
    queryFn: async (): Promise<RecurringScheduleWithCustomer[]> => {
      let q = supabase
        .from("recurring_order_schedules")
        .select(
          "*, customers!inner(display_name, customer_number), recurring_order_items(id)",
        )
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .order("is_active", { ascending: false });

      if (!filter.status || filter.status === "active") {
        q = q.eq("is_active", true);
      } else if (filter.status === "inactive") {
        q = q.eq("is_active", false);
      }

      const { data, error } = await q;
      if (error) throw error;

      let rows = (data ?? []).map((row: any) => ({
        id: row.id,
        customer_id: row.customer_id,
        legal_entity_id: row.legal_entity_id,
        name: row.name,
        is_active: row.is_active,
        valid_from: row.valid_from,
        valid_to: row.valid_to,
        notes: row.notes,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        customer_display_name: row.customers?.display_name ?? "",
        customer_number: row.customers?.customer_number ?? "",
        item_count: row.recurring_order_items?.length ?? 0,
      })) as RecurringScheduleWithCustomer[];

      if (filter.search?.trim()) {
        const s = filter.search.trim().toLowerCase();
        rows = rows.filter(
          (r) =>
            r.customer_display_name.toLowerCase().includes(s) ||
            r.customer_number.toLowerCase().includes(s) ||
            r.name.toLowerCase().includes(s),
        );
      }

      rows.sort((a, b) =>
        a.customer_display_name.localeCompare(b.customer_display_name, "nb"),
      );
      return rows;
    },
    staleTime: 30_000,
  });
}

/** Hent én mal med alle linjer. */
export function useRecurringScheduleDetail(scheduleId: string | null | undefined) {
  return useQuery({
    queryKey: ["recurring-schedule-detail", scheduleId],
    enabled: !!scheduleId,
    queryFn: async (): Promise<{
      schedule: RecurringSchedule;
      items: RecurringItem[];
    } | null> => {
      const { data: sched, error: sErr } = await supabase
        .from("recurring_order_schedules")
        .select("*")
        .eq("id", scheduleId!)
        .maybeSingle();
      if (sErr) throw sErr;
      if (!sched) return null;

      const { data: items, error: iErr } = await supabase
        .from("recurring_order_items")
        .select("*")
        .eq("schedule_id", scheduleId!)
        .order("weekday", { ascending: true });
      if (iErr) throw iErr;

      return {
        schedule: sched as RecurringSchedule,
        items: (items ?? []) as RecurringItem[],
      };
    },
  });
}

export type SaveSchedulePayload = {
  id?: string;
  customer_id: string;
  name: string;
  is_active: boolean;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
  items: Array<{
    id?: string;
    product_id: string;
    weekday: number;
    tour_id: string | null;
    quantity: number;
    notes: string | null;
  }>;
};

/** Opprett/oppdater en mal m/ linjer. Sletter linjer som ikke lenger er med. */
export function useSaveRecurringSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: SaveSchedulePayload) => {
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id ?? null;

      let scheduleId = payload.id;
      if (scheduleId) {
        const { error } = await supabase
          .from("recurring_order_schedules")
          .update({
            name: payload.name,
            is_active: payload.is_active,
            valid_from: payload.valid_from,
            valid_to: payload.valid_to,
            notes: payload.notes,
          })
          .eq("id", scheduleId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("recurring_order_schedules")
          .insert({
            customer_id: payload.customer_id,
            legal_entity_id: NB_LEGAL_ENTITY_ID,
            name: payload.name,
            is_active: payload.is_active,
            valid_from: payload.valid_from,
            valid_to: payload.valid_to,
            notes: payload.notes,
            created_by: userId,
          })
          .select("id")
          .single();
        if (error) throw error;
        scheduleId = data.id;
      }

      // Hent eksisterende linjer for diff
      const { data: existing, error: eErr } = await supabase
        .from("recurring_order_items")
        .select("id")
        .eq("schedule_id", scheduleId!);
      if (eErr) throw eErr;

      const existingIds = new Set((existing ?? []).map((r) => r.id));
      const keptIds = new Set(payload.items.filter((i) => i.id).map((i) => i.id!));
      const toDelete = [...existingIds].filter((id) => !keptIds.has(id));

      if (toDelete.length > 0) {
        const { error } = await supabase
          .from("recurring_order_items")
          .delete()
          .in("id", toDelete);
        if (error) throw error;
      }

      // Upsert linjer (en og en for å gi gode feilmeldinger ved unique-konflikt)
      for (const item of payload.items) {
        if (item.id) {
          const { error } = await supabase
            .from("recurring_order_items")
            .update({
              product_id: item.product_id,
              weekday: item.weekday,
              tour_id: item.tour_id,
              quantity: item.quantity,
              notes: item.notes,
            })
            .eq("id", item.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("recurring_order_items").insert({
            schedule_id: scheduleId,
            product_id: item.product_id,
            weekday: item.weekday,
            tour_id: item.tour_id,
            quantity: item.quantity,
            notes: item.notes,
          });
          if (error) throw error;
        }
      }

      return { scheduleId };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recurring-schedules"] });
      void qc.invalidateQueries({ queryKey: ["recurring-schedule-detail"] });
    },
  });
}

export function useDeleteRecurringSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("recurring_order_schedules")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recurring-schedules"] });
    },
  });
}

export const WEEKDAY_SHORT = ["Ma", "Ti", "On", "To", "Fr", "Lø", "Sø"] as const;
export const WEEKDAY_LONG = [
  "Mandag",
  "Tirsdag",
  "Onsdag",
  "Torsdag",
  "Fredag",
  "Lørdag",
  "Søndag",
] as const;
