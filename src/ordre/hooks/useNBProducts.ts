import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { osloTodayISO } from "@/lib/osloDate";

export type ProductOption = {
  id: string;
  display_number: number;
  code: string;
  display_name: string;
  unit_of_sale: string;
  mva_rate: number;
  status: string;
  is_for_sale: boolean;
  is_divisible: boolean;
};

/**
 * Henter aktive selgbare produkter for NB AS.
 * Hvis `priceListId` er satt: returnerer kun produkter som har en pris i den prislisten,
 * sortert etter `display_number` synkende.
 */
export function useNBProducts(search?: string, priceListId?: string | null) {
  return useQuery({
    queryKey: ["nb-products", search ?? "", priceListId ?? null],
    queryFn: async (): Promise<ProductOption[]> => {
      // Krav: kun produkter som har en gyldig pris i kundens prisliste.
      // Hvis kunden ikke har prisliste → ingen produkter (unngå å vise alt).
      if (!priceListId) return [];

      const today = osloTodayISO();
      // Join via embedded relation slik at vi slipper å sende hundrevis av IDs i URL-en (→ 414/400).
      let q = supabase
        .from("price_list_items")
        .select(
          "product_id, products!inner(id, display_number, code, display_name, unit_of_sale, mva_rate, status, is_for_sale, is_divisible, legal_entity_id)",
        )
        .eq("price_list_id", priceListId)
        .gt("price", 0)
        .lte("valid_from", today)
        .or(`valid_to.is.null,valid_to.gte.${today}`)
        .eq("products.legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("products.is_for_sale", true)
        .neq("products.status", "discontinued")
        .limit(2000);

      const rawSearch = search?.trim() ?? "";
      const isNumericSearch = /^\d+$/.test(rawSearch);
      if (rawSearch.length > 0) {
        const s = rawSearch.replace(/[%,]/g, " ");
        // Numerisk søk: operatøren skriver varenummeret hun ser i UI-et.
        const filters = isNumericSearch
          ? [`display_number.eq.${Number(s)}`, `code.ilike.%${s}%`, `display_name.ilike.%${s}%`]
          : [`display_name.ilike.%${s}%`, `code.ilike.%${s}%`];
        q = q.or(filters.join(","), { foreignTable: "products" });
      }

      const { data, error } = await q;
      if (error) throw error;
      const seen = new Set<string>();
      const out: ProductOption[] = [];
      type ProductRow = {
        id: string;
        display_number: number | string;
        code: string;
        display_name: string;
        unit_of_sale: string;
        mva_rate: number | string | null;
        status: string;
        is_for_sale: boolean;
        is_divisible: boolean | null;
      };
      for (const row of (data ?? []) as unknown as Array<{ products: ProductRow | null }>) {
        const p = row.products;
        if (!p || seen.has(p.id)) continue;
        seen.add(p.id);
        out.push({
          id: p.id,
          display_number: Number(p.display_number),
          code: p.code,
          display_name: p.display_name,
          unit_of_sale: p.unit_of_sale,
          mva_rate: Number(p.mva_rate ?? 0),
          status: p.status,
          is_for_sale: p.is_for_sale,
          is_divisible: !!p.is_divisible,
        });
      }
      if (isNumericSearch) {
        // Eksakt varenummer først, deretter kodetreff, så navnetreff.
        const n = Number(rawSearch);
        const lower = rawSearch.toLowerCase();
        const rank = (p: ProductOption) => {
          if (p.display_number === n) return 0;
          if ((p.code ?? "").toLowerCase() === lower) return 1;
          if ((p.code ?? "").toLowerCase().includes(lower)) return 2;
          return 3;
        };
        out.sort((a, b) => rank(a) - rank(b) || b.display_number - a.display_number);
      } else {
        out.sort((a, b) => b.display_number - a.display_number);
      }
      return out.slice(0, 500);

    },
    staleTime: 30_000,
  });
}

export type EffectivePrice = {
  /** Eks-MVA pris klar for lagring i order_lines.unit_price */
  price: number;
  vat_rate: number;
  source: string;
  special_price_id: string | null;
  price_list_id: string | null;
  is_fallback: boolean;
};

export type PriceCaller =
  | "matrix_save"
  | "customer_order_create"
  | "customer_order_update"
  | "new_order_form"
  | "fastordre_instantiation"
  | "unknown";

/**
 * Henter effektiv enhets-pris (eks-MVA) for én kunde + ett produkt på en gitt dato.
 * Bruker den sentrale RPC-en `get_customer_unit_price` som respekterer hele
 * precedence-hierarkiet (special_prices → prislister → fallback_zero).
 */
export async function fetchEffectivePrice(params: {
  productId: string;
  customerId: string;
  date: string;
  caller?: PriceCaller;
}): Promise<EffectivePrice | null> {
  const { data, error } = await supabase.rpc("get_customer_unit_price", {
    p_customer_id: params.customerId,
    p_product_id: params.productId,
    p_date: params.date,
    p_caller: params.caller ?? "unknown",
  });
  if (error) throw error;
  if (!data || data.length === 0) return null;
  const row = data[0] as {
    unit_price_excl_mva: number | string;
    vat_rate: number | string;
    source: string;
    special_price_id: string | null;
    price_list_id: string | null;
    is_fallback: boolean;
  };
  return {
    price: Number(row.unit_price_excl_mva),
    vat_rate: Number(row.vat_rate),
    source: String(row.source),
    special_price_id: row.special_price_id,
    price_list_id: row.price_list_id,
    is_fallback: Boolean(row.is_fallback),
  };
}

/** Batch-variant: én RPC-runde for mange produkter (samme kunde + dato). */
export async function fetchEffectivePricesBatch(params: {
  productIds: string[];
  customerId: string;
  date: string;
  caller?: PriceCaller;
}): Promise<Map<string, EffectivePrice>> {
  const out = new Map<string, EffectivePrice>();
  if (params.productIds.length === 0) return out;
  const { data, error } = await supabase.rpc("get_customer_unit_prices_batch", {
    p_customer_id: params.customerId,
    p_product_ids: params.productIds,
    p_date: params.date,
    p_caller: params.caller ?? "unknown",
  });
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    product_id: string;
    unit_price_excl_mva: number | string;
    vat_rate: number | string;
    source: string;
    special_price_id: string | null;
    price_list_id: string | null;
    is_fallback: boolean;
  }>) {
    out.set(row.product_id, {
      price: Number(row.unit_price_excl_mva),
      vat_rate: Number(row.vat_rate),
      source: String(row.source),
      special_price_id: row.special_price_id,
      price_list_id: row.price_list_id,
      is_fallback: Boolean(row.is_fallback),
    });
  }
  return out;
}

/** Mapper get_effective_price.source → enkel "kategori" for badge-fargekoding */
export function categorizePriceSource(source: string | null | undefined): {
  category: "standard" | "special_general" | "special_customer" | "manual" | "none";
  label: string;
} {
  if (!source || source === "none") return { category: "none", label: "Ingen pris" };
  if (source === "manual_override") return { category: "manual", label: "Manuell" };
  if (source.startsWith("special_customer")) return { category: "special_customer", label: "Kundespesial" };
  if (source.startsWith("special_price_list")) return { category: "special_general", label: "Spesialpris" };
  if (source.endsWith("price_list")) return { category: "standard", label: "Standard" };
  return { category: "standard", label: source };
}
