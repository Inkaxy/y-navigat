import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CalcType =
  | "oppskrift"
  | "arvet"
  | "handelsvare"
  | "bakeoff"
  | "halvfabrikat"
  | "sammensatt"
  | "manuell";

export type MarkupMode = "prosent" | "kroner";
export type PriceLevel = "internpris" | "engros" | "utsalg";

export const CALC_TYPE_LABEL: Record<CalcType, string> = {
  oppskrift: "Oppskrift",
  arvet: "Arvet",
  handelsvare: "Handelsvare",
  bakeoff: "Bakeoff",
  halvfabrikat: "Halvfabrikat",
  sammensatt: "Sammensatt",
  manuell: "Manuell",
};

export const CALC_TYPE_HELP: Record<CalcType, string> = {
  oppskrift: "Varen har egen oppskrift med råvarer og arbeid",
  arvet: "Samme vare som en annen, med en faktor — «(stekt)», «(retur)», brett à 40, halv porsjon",
  handelsvare: "Kjøpes inn og selges videre nesten uendret",
  bakeoff: "Kjøpes ferdig, stekes eller tines før salg",
  halvfabrikat: "Deig, krem, fyll eller skolding. Har kostpris, men ingen salgspris",
  sammensatt: "Satt sammen av flere andre varer",
  manuell: "Kostpris tastes inn",
};

export const PRICE_LEVEL_LABEL: Record<PriceLevel, string> = {
  internpris: "Internpris",
  engros: "Engros",
  utsalg: "Utsalg",
};

export const PRICE_LEVEL_ORDER: PriceLevel[] = ["internpris", "engros", "utsalg"];

export const TARGET_SOURCE_LABEL: Record<string, string> = {
  kategori: "fra kategori",
  category: "fra kategori",
  main_category: "fra kategori",
  type: "fra type",
  calc_type: "fra type",
  vare: "overstyrt på varen",
  product: "overstyrt på varen",
  overstyrt: "overstyrt på varen",
  standard: "selskapets standard",
  default: "selskapets standard",
};

export interface ProductCost {
  ok?: boolean;
  calc_type?: CalcType | string;
  has_cost?: boolean;
  quality?: "A" | "B" | "C" | string;
  notes?: string[];
  raw_cost?: number | null;
  labor_cost?: number | null;
  packaging_cost?: number | null;
  energy_cost?: number | null;
  cost_price?: number | null;
  cost_per_gram?: number | null;
  units_per_batch?: number | null;
  dough_grams?: number | null;
  dough_waste_pct?: number | null;
  dough_piece_grams?: number | null;
  purchase_cost?: number | null;
  shrinkage_cost?: number | null;
  freight_cost?: number | null;
  handling_cost?: number | null;
  storage_cost?: number | null;
  packaging_mode?: "legges_til" | "trekkes_fra" | string;
  hourly_rate?: number | null;
}

export type MarginStatus =
  | "gronn"
  | "gul"
  | "rod"
  | "ingen_pris"
  | "forelopig"
  | "ikke_vurdert"
  | "halvfabrikat";

export interface MarginLevel {
  price_list_id: string;
  code: string | null;
  name: string | null;
  price_level: PriceLevel | string;
  is_provisional: boolean | null;
  price: number | null;
  price_with_packaging: number | null;
  brutto_pct: number | null;
  db2: number | null;
  dg2_pct: number | null;
  target_brutto_pct: number | null;
  target_dg2_pct: number | null;
  target_source: string | null;
  avvik_pp: number | null;
  needed_price: number | null;
  needed_change_pct: number | null;
  status: MarginStatus | string;
}

export interface ProductMargins {
  ok?: boolean;
  has_cost?: boolean;
  product?: string;
  calc_type?: CalcType | string;
  cost?: ProductCost;
  levels?: MarginLevel[];
}

/** Kalkyle og marginer for en vare — regnes i databasen. */
export function useProductMargins(productId: string | null | undefined) {
  return useQuery({
    queryKey: ["product-margins", productId],
    enabled: !!productId,
    queryFn: async (): Promise<ProductMargins> => {
      const { data, error } = await (supabase as any).rpc("product_margins", {
        p_product_id: productId,
      });
      if (error) throw error;
      return (data ?? {}) as ProductMargins;
    },
  });
}

export interface CalcSettings {
  legal_entity_id: string;
  hourly_rate: number | null;
  packaging_mode: string | null;
  markup_engros_pct: number | null;
  markup_utsalg_pct: number | null;
  default_vat_rate: number | null;
  default_dough_waste_pct: number | null;
}

export function useCalcSettings(legalEntityId: string | null) {
  return useQuery({
    queryKey: ["entity-calc-settings", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<CalcSettings | null> => {
      const { data, error } = await (supabase as any)
        .from("entity_calc_settings")
        .select(
          "legal_entity_id, hourly_rate, packaging_mode, markup_engros_pct, markup_utsalg_pct, default_vat_rate, default_dough_waste_pct",
        )
        .eq("legal_entity_id", legalEntityId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as CalcSettings | null;
    },
  });
}

/** Halvfabrikat i samme selskap — brukes som ingrediens i oppskrifter. */
export function useSubProducts(legalEntityId: string | null) {
  return useQuery({
    queryKey: ["sub-products", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("products")
        .select("id, display_name, product_number")
        .eq("legal_entity_id", legalEntityId)
        .eq("calc_type", "halvfabrikat")
        .order("display_name");
      if (error) throw error;
      return (data ?? []) as { id: string; display_name: string; product_number: string | null }[];
    },
  });
}
