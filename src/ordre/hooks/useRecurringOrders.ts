import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";

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

type RecurringScheduleQueryRow = RecurringSchedule & {
  customers?: { display_name: string | null; customer_number: string | null } | null;
  recurring_order_items?: Array<{ id: string }> | null;
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
  customer_id?: string;
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

      if (filter.customer_id) {
        q = q.eq("customer_id", filter.customer_id);
      }

      const { data, error } = await q;
      if (error) throw error;

      let rows = ((data ?? []) as RecurringScheduleQueryRow[]).map((row) => ({
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

      // Erstatt alle linjer atomisk (delete + insert i én transaksjon)
      const rows = payload.items.map((item) => ({
        schedule_id: scheduleId,
        product_id: item.product_id,
        weekday: item.weekday,
        tour_id: item.tour_id,
        quantity: item.quantity,
        notes: item.notes,
      }));
      const { error: replaceErr } = await (supabase as any).rpc("replace_child_rows", {
        p_table: "recurring_order_items",
        p_parent_column: "schedule_id",
        p_parent_id: scheduleId,
        p_rows: rows,
      });
      if (replaceErr) throw replaceErr;

      return { scheduleId };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recurring-schedules"] });
      void qc.invalidateQueries({ queryKey: ["recurring-schedule-detail"] });
      void qc.invalidateQueries({ queryKey: ["delivery-note-counts"] });
      void qc.invalidateQueries({ queryKey: ["tour-order-counts"] });
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

/** Kopierer en fastordre-mal inkl. alle linjer til en ny (inaktiv) mal. */
export function useDuplicateRecurringSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sourceId: string): Promise<{ scheduleId: string }> => {
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id ?? null;

      const { data: src, error: sErr } = await supabase
        .from("recurring_order_schedules")
        .select("*")
        .eq("id", sourceId)
        .maybeSingle();
      if (sErr) throw sErr;
      if (!src) throw new Error("Fant ikke original mal");

      const { data: items, error: iErr } = await supabase
        .from("recurring_order_items")
        .select("product_id, weekday, tour_id, quantity, notes")
        .eq("schedule_id", sourceId);
      if (iErr) throw iErr;

      const { data: created, error: cErr } = await supabase
        .from("recurring_order_schedules")
        .insert({
          customer_id: src.customer_id,
          legal_entity_id: src.legal_entity_id,
          name: `${src.name} (kopi)`,
          is_active: false,
          valid_from: src.valid_from,
          valid_to: src.valid_to,
          notes: src.notes,
          created_by: userId,
        })
        .select("id")
        .single();
      if (cErr) throw cErr;

      if (items && items.length > 0) {
        const rows = items.map((it) => ({
          schedule_id: created.id,
          product_id: it.product_id,
          weekday: it.weekday,
          tour_id: it.tour_id,
          quantity: it.quantity,
          notes: it.notes,
        }));
        const { error: insErr } = await supabase
          .from("recurring_order_items")
          .insert(rows);
        if (insErr) throw insErr;
      }

      return { scheduleId: created.id };
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

/**
 * Skriver ukens antall for ÉN vare inn i kundens fastordre.
 * Erstatter alle recurring_order_items for (schedule, product) med de oppgitte
 * (weekday, tour_id, quantity)-radene. Oppretter en aktiv mal om kunden ikke har en.
 */
export function useUpsertRecurringForProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      customerId: string;
      productId: string;
      scheduleId?: string | null;
      items: Array<{ weekday: number; tour_id: string | null; quantity: number }>;
    }): Promise<{ scheduleId: string; written: number }> => {
      let scheduleId = input.scheduleId ?? null;

      if (!scheduleId) {
        const { data: existing, error: exErr } = await supabase
          .from("recurring_order_schedules")
          .select("id")
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
          .eq("customer_id", input.customerId)
          .eq("is_active", true)
          .order("created_at", { ascending: true })
          .limit(1);
        if (exErr) throw exErr;
        scheduleId = existing?.[0]?.id ?? null;
      }

      if (!scheduleId) {
        const { data: userRes } = await supabase.auth.getUser();
        const { data: created, error: cErr } = await supabase
          .from("recurring_order_schedules")
          .insert({
            customer_id: input.customerId,
            legal_entity_id: NB_LEGAL_ENTITY_ID,
            name: "Fastordre",
            is_active: true,
            valid_from: null,
            valid_to: null,
            notes: null,
            created_by: userRes.user?.id ?? null,
          })
          .select("id")
          .single();
        if (cErr) throw cErr;
        scheduleId = created.id;
      }

      const { error: delErr } = await supabase
        .from("recurring_order_items")
        .delete()
        .eq("schedule_id", scheduleId)
        .eq("product_id", input.productId);
      if (delErr) throw delErr;

      const rows = input.items
        .filter((i) => i.quantity > 0)
        .map((i) => ({
          schedule_id: scheduleId!,
          product_id: input.productId,
          weekday: i.weekday,
          tour_id: i.tour_id,
          quantity: i.quantity,
          notes: null as string | null,
        }));

      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("recurring_order_items").insert(rows);
        if (insErr) throw insErr;
      }

      return { scheduleId, written: rows.length };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recurring-schedules"] });
      void qc.invalidateQueries({ queryKey: ["recurring-schedule-detail"] });
      void qc.invalidateQueries({ queryKey: ["recurring-ghost"] });
    },
  });
}
