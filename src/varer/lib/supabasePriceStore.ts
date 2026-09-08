import { supabase } from "@/integrations/supabase/client";
import type { PricePersistence, PriceRowRef } from "./priceWrite";

/** Supabase-implementasjon av prisskrivingen. Kaster ved feil. */
export const supabasePriceStore: PricePersistence = {
  async findActive(priceListId, productId, date): Promise<PriceRowRef | null> {
    const { data, error } = await supabase
      .from("price_list_items")
      .select("id, price, valid_from, valid_to")
      .eq("price_list_id", priceListId)
      .eq("product_id", productId)
      .lte("valid_from", date)
      .or(`valid_to.is.null,valid_to.gte.${date}`)
      .order("valid_from", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const row = data?.[0];
    if (!row) return null;
    return {
      id: row.id,
      price: Number(row.price),
      valid_from: row.valid_from,
      valid_to: row.valid_to,
    };
  },

  async updatePrice(rowId, price) {
    const { error } = await supabase.from("price_list_items").update({ price }).eq("id", rowId);
    if (error) throw new Error(error.message);
  },

  async closePeriod(rowId, validTo) {
    const { error } = await supabase
      .from("price_list_items")
      .update({ valid_to: validTo })
      .eq("id", rowId);
    if (error) throw new Error(error.message);
  },

  async insertPeriod({ priceListId, productId, price, validFrom }) {
    const { data, error } = await supabase
      .from("price_list_items")
      .insert({
        price_list_id: priceListId,
        product_id: productId,
        price,
        valid_from: validFrom,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  },
};

/** Query-nøkler som må invalideres etter enhver prisendring. */
export const PRICE_QUERY_KEYS = [
  ["matrix-prices"],
  ["pricelist-items"],
  ["price-list-items"],
  ["product-prices"],
  ["product-margins"],
  ["profitability-sheet"],
  ["product-cost"],
] as const;
