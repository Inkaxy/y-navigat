import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StockItemBalanceRow {
  id: string;
  name: string;
  department_id: string | null;
  department_name: string | null;
  base_unit: string;
  pieces_per_tray: number | null;
  min_level: number | null;
  max_level: number | null;
  shelf_life_days: number | null;
  batch_tracking: boolean;
  status: string;
  defined_by_product_id: string | null;
  on_hand: number;
  produced_today: number;
  out_today: number;
  linked_products: number;
  level_status: string;
}

function mapBalance(row: Record<string, any>): StockItemBalanceRow {
  return {
    id: row.id,
    name: row.name ?? "",
    department_id: row.department_id ?? null,
    department_name: row.department_name ?? null,
    base_unit: row.base_unit ?? "stk",
    pieces_per_tray: row.pieces_per_tray == null ? null : Number(row.pieces_per_tray),
    min_level: row.min_level == null ? null : Number(row.min_level),
    max_level: row.max_level == null ? null : Number(row.max_level),
    shelf_life_days: row.shelf_life_days == null ? null : Number(row.shelf_life_days),
    batch_tracking: !!row.batch_tracking,
    status: row.status ?? "active",
    defined_by_product_id: row.defined_by_product_id ?? null,
    on_hand: Number(row.on_hand ?? 0),
    produced_today: Number(row.produced_today ?? 0),
    out_today: Number(row.out_today ?? 0),
    linked_products: Number(row.linked_products ?? 0),
    level_status: row.level_status ?? "ok",
  };
}

/** Alle aktive lagervarer i selskapet (med beholdning). */
export function useStockItemBalances(legalEntityId: string | undefined) {
  return useQuery({
    queryKey: ["stock_item_balance", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<StockItemBalanceRow[]> => {
      const { data, error } = await supabase
        .from("stock_item_balance")
        .select("*")
        .eq("legal_entity_id", legalEntityId!)
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return ((data ?? []) as Record<string, any>[]).map(mapBalance);
    },
  });
}

export interface ProductStockState {
  link: { id: string; stock_item_id: string; units_per_sold_unit: number } | null;
  stockItem: StockItemBalanceRow | null;
  ownStockItemId: string | null;
  family: { product_id: string; display_name: string; display_number: number | null; units_per_sold_unit: number }[];
}

/** Koblingen for én vare, lagervaren den peker på, og hele «familien». */
export function useProductStock(productId: string | undefined) {
  return useQuery({
    queryKey: ["product-stock", productId],
    enabled: !!productId,
    queryFn: async (): Promise<ProductStockState> => {
      const [linkRes, ownRes] = await Promise.all([
        supabase
          .from("product_stock_links")
          .select("id, stock_item_id, units_per_sold_unit")
          .eq("product_id", productId!)
          .maybeSingle(),
        supabase
          .from("stock_items")
          .select("id")
          .eq("defined_by_product_id", productId!)
          .maybeSingle(),
      ]);
      if (linkRes.error) throw linkRes.error;

      const link = linkRes.data
        ? {
            id: linkRes.data.id,
            stock_item_id: linkRes.data.stock_item_id,
            units_per_sold_unit: Number(linkRes.data.units_per_sold_unit ?? 1),
          }
        : null;

      const stockItemId = link?.stock_item_id ?? ownRes.data?.id ?? null;

      let stockItem: StockItemBalanceRow | null = null;
      let family: ProductStockState["family"] = [];

      if (stockItemId) {
        const [balRes, famRes] = await Promise.all([
          supabase.from("stock_item_balance").select("*").eq("id", stockItemId).maybeSingle(),
          supabase
            .from("product_stock_links")
            .select("product_id, units_per_sold_unit, products(display_name, display_number)")
            .eq("stock_item_id", stockItemId),
        ]);
        if (balRes.data) stockItem = mapBalance(balRes.data as Record<string, any>);
        family = ((famRes.data ?? []) as Record<string, any>[]).map((r) => ({
          product_id: r.product_id,
          display_name: r.products?.display_name ?? "Ukjent vare",
          display_number: r.products?.display_number ?? null,
          units_per_sold_unit: Number(r.units_per_sold_unit ?? 1),
        }));
        family.sort((a, b) => (a.display_number ?? 0) - (b.display_number ?? 0));
      }

      return { link, stockItem, ownStockItemId: ownRes.data?.id ?? null, family };
    },
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>, productId: string) {
  qc.invalidateQueries({ queryKey: ["product-stock", productId] });
  qc.invalidateQueries({ queryKey: ["stock_item_balance"] });
  qc.invalidateQueries({ queryKey: ["stock_batch_balance"] });
}

/** Fjerner koblingen — varen holdes ikke på lager. */
export function useRemoveStockLink(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("product_stock_links").delete().eq("product_id", productId);
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, productId),
  });
}

export interface StockItemFormInput {
  name: string;
  department_id: string | null;
  pieces_per_tray: number | null;
  min_level: number | null;
  shelf_life_days: number | null;
  batch_tracking: boolean;
  units_per_sold_unit: number;
}

/** Oppretter/oppdaterer lagervaren som denne varen definerer, og kobler varen til den. */
export function useSaveOwnStockItem(productId: string, legalEntityId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StockItemFormInput & { stockItemId?: string | null }) => {
      const payload = {
        legal_entity_id: legalEntityId!,
        name: input.name.trim(),
        department_id: input.department_id,
        defined_by_product_id: productId,
        pieces_per_tray: input.pieces_per_tray,
        min_level: input.min_level,
        shelf_life_days: input.shelf_life_days,
        batch_tracking: input.batch_tracking,
      };

      let stockItemId = input.stockItemId ?? null;
      if (stockItemId) {
        const { error } = await supabase.from("stock_items").update(payload as never).eq("id", stockItemId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("stock_items")
          .insert(payload as never)
          .select("id")
          .single();
        if (error) throw error;
        stockItemId = (data as { id: string }).id;
      }

      const { error: linkErr } = await supabase
        .from("product_stock_links")
        .upsert(
          {
            product_id: productId,
            stock_item_id: stockItemId!,
            units_per_sold_unit: input.units_per_sold_unit,
          } as never,
          { onConflict: "product_id" },
        );
      if (linkErr) throw linkErr;
      return stockItemId!;
    },
    onSuccess: () => invalidate(qc, productId),
  });
}

/** Kobler varen til en eksisterende lagervare. */
export function useSaveStockLink(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { stock_item_id: string; units_per_sold_unit: number }) => {
      const { error } = await supabase
        .from("product_stock_links")
        .upsert(
          {
            product_id: productId,
            stock_item_id: input.stock_item_id,
            units_per_sold_unit: input.units_per_sold_unit,
          } as never,
          { onConflict: "product_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, productId),
  });
}
