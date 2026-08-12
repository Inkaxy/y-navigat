import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface LagerItem {
  id: string;
  name: string;
  department_id: string | null;
  department_name: string | null;
  base_unit: string;
  pieces_per_tray: number | null;
  min_level: number | null;
  max_level: number | null;
  batch_tracking: boolean;
  on_hand: number;
  produced_today: number;
  out_today: number;
  level_status: string;
}

export interface LagerBatch {
  batch_id: string;
  stock_item_id: string;
  batch_number: string;
  produced_on: string;
  expires_on: string | null;
  initial_quantity: number;
  remaining: number;
  expiry_status: string;
}

export function useLagerItems(legalEntityId: string | undefined) {
  return useQuery({
    queryKey: ["stock_item_balance", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<LagerItem[]> => {
      const { data, error } = await supabase
        .from("stock_item_balance")
        .select("*")
        .eq("legal_entity_id", legalEntityId!)
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return ((data ?? []) as Record<string, any>[]).map((r) => ({
        id: r.id,
        name: r.name ?? "",
        department_id: r.department_id ?? null,
        department_name: r.department_name ?? null,
        base_unit: r.base_unit ?? "stk",
        pieces_per_tray: r.pieces_per_tray == null ? null : Number(r.pieces_per_tray),
        min_level: r.min_level == null ? null : Number(r.min_level),
        max_level: r.max_level == null ? null : Number(r.max_level),
        batch_tracking: !!r.batch_tracking,
        on_hand: Number(r.on_hand ?? 0),
        produced_today: Number(r.produced_today ?? 0),
        out_today: Number(r.out_today ?? 0),
        level_status: r.level_status ?? "ok",
      }));
    },
  });
}

export function useLagerBatches(stockItemId: string | undefined) {
  return useQuery({
    queryKey: ["stock_batch_balance", stockItemId],
    enabled: !!stockItemId,
    queryFn: async (): Promise<LagerBatch[]> => {
      const { data, error } = await supabase
        .from("stock_batch_balance")
        .select("*")
        .eq("stock_item_id", stockItemId!)
        .order("produced_on", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as Record<string, any>[]).map((r) => ({
        batch_id: r.batch_id,
        stock_item_id: r.stock_item_id,
        batch_number: r.batch_number ?? "",
        produced_on: r.produced_on ?? "",
        expires_on: r.expires_on ?? null,
        initial_quantity: Number(r.initial_quantity ?? 0),
        remaining: Number(r.remaining ?? 0),
        expiry_status: r.expiry_status ?? "ingen",
      }));
    },
  });
}

function invalidateStock(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["stock_item_balance"] });
  qc.invalidateQueries({ queryKey: ["stock_batch_balance"] });
  qc.invalidateQueries({ queryKey: ["product-stock"] });
  qc.invalidateQueries({ queryKey: ["stock_movements"] });
}

export interface RegisterProductionResult {
  ok?: boolean;
  quantity?: number;
  batch_id?: string;
  batch_number?: string;
  expires_on?: string | null;
  on_hand?: number;
}

export function useRegisterProduction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      stock_item_id: string;
      trays?: number;
      pieces?: number;
      batch_number?: string;
      expires_on?: string;
      department_id?: string;
      note?: string;
    }): Promise<RegisterProductionResult> => {
      const { data, error } = await supabase.rpc("stock_register_production", {
        p_stock_item_id: args.stock_item_id,
        p_trays: args.trays,
        p_pieces: args.pieces,
        p_batch_number: args.batch_number,
        p_expires_on: args.expires_on,
        p_department_id: args.department_id,
        p_note: args.note,
      });
      if (error) throw error;
      return (data ?? {}) as RegisterProductionResult;
    },
    onSuccess: () => invalidateStock(qc),
  });
}

export function useStockAdjust() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      stock_item_id: string;
      delta: number;
      kind: "waste" | "correction" | "count_adjust";
      reason?: string;
      batch_id?: string;
      note?: string;
    }): Promise<{ ok?: boolean; on_hand?: number }> => {
      const { data, error } = await supabase.rpc("stock_adjust", {
        p_stock_item_id: args.stock_item_id,
        p_delta: args.delta,
        p_kind: args.kind,
        p_reason: args.reason,
        p_batch_id: args.batch_id,
        p_note: args.note,
      });
      if (error) throw error;
      return (data ?? {}) as { ok?: boolean; on_hand?: number };
    },
    onSuccess: () => invalidateStock(qc),
  });
}

/** Realtime: andre nettbrett sine registreringer oppdaterer beholdningen her. */
export function useStockRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("stock-movements-lager")
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_movements" }, () => {
        qc.invalidateQueries({ queryKey: ["stock_item_balance"] });
        qc.invalidateQueries({ queryKey: ["stock_batch_balance"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}

export interface StockCountLine {
  stock_item_id: string;
  batch_id?: string;
  counted: number;
}

export interface StockCountResult {
  ok?: boolean;
  adjusted?: number;
  unchanged?: number;
  rows?: {
    stock_item_id: string;
    name: string;
    batch_id: string | null;
    before: number;
    counted: number;
    diff: number;
  }[];
}

/** Bokfører en varetelling — differansen mot beholdning føres som count_adjust. */
export function useStockCountApply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { lines: StockCountLine[]; note?: string }): Promise<StockCountResult> => {
      const { data, error } = await supabase.rpc("stock_count_apply", {
        p_lines: args.lines as unknown as never,
        p_note: args.note,
      });
      if (error) throw error;
      return (data ?? {}) as StockCountResult;
    },
    onSuccess: () => invalidateStock(qc),
  });
}

export interface StockMovementRow {
  id: string;
  stock_item_id: string;
  batch_id: string | null;
  movement_type: string;
  quantity_base: number;
  occurred_at: string;
  reason: string | null;
  note: string | null;
}

export const MOVEMENT_LABELS: Record<string, string> = {
  production_in: "Produksjon",
  waste: "Svinn",
  correction: "Korrigering",
  count_adjust: "Telling",
};

/** Dagens bevegelser på lagervarer (nyeste først). */
export function useTodayStockMovements(legalEntityId: string | undefined) {
  return useQuery({
    queryKey: ["stock_movements", "today", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<StockMovementRow[]> => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("stock_movements")
        .select("id, stock_item_id, batch_id, movement_type, quantity_base, occurred_at, reason, note")
        .eq("legal_entity_id", legalEntityId!)
        .not("stock_item_id", "is", null)
        .gte("occurred_at", start.toISOString())
        .order("occurred_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return ((data ?? []) as Record<string, any>[]).map((r) => ({
        id: r.id,
        stock_item_id: r.stock_item_id,
        batch_id: r.batch_id ?? null,
        movement_type: r.movement_type ?? "",
        quantity_base: Number(r.quantity_base ?? 0),
        occurred_at: r.occurred_at,
        reason: r.reason ?? null,
        note: r.note ?? null,
      }));
    },
  });
}
