import { z } from "zod";
import { UNITS_OF_SALE } from "./constants";

const LABEL_MODES = ["none", "per_unit", "per_order", "per_order_or_note", "per_note"] as const;
const LABEL_PRINT_MODELS = ["standard", "orig_plus_copy"] as const;
const RETURN_PRICE_TYPES = ["percent", "amount"] as const;
const CAKE_ROLES = ["base", "topping", "filling", "customization", "info"] as const;

const numOrNull = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
  z.number().nullable(),
);

const intOrNull = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : Math.trunc(Number(v))),
  z.number().int().nullable(),
);

const dateOrNull = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.string().nullable(),
);

const textOrNull = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : String(v)),
  z.string().nullable(),
);

/**
 * Hver tab-felt-gruppe er flate i ett schema slik at vi enkelt kan
 * mappe `dirtyFields` til hvilken tab feilen tilhører.
 */
export const productSchema = z.object({
  // Tab: Navn og nummer
  display_name: z.string().trim().min(1, "Navn er påkrevd").max(120),
  unit_of_sale: z.enum(UNITS_OF_SALE),
  is_divisible: z.boolean(),
  pieces_per_unit: numOrNull,
  is_for_sale: z.boolean(),
  in_web_shop: z.boolean(),
  include_in_price_lists: z.boolean(),
  in_pos: z.boolean(),
  gtin: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : String(v)),
    z.string().regex(/^\d{13}$/, "GTIN må være 13 siffer").nullable(),
  ),
  epd_number: textOrNull,
  mva_rate: z.coerce.number(),
  eatin_mva_rate: numOrNull,
  mva_always_included: z.boolean(),
  account_reference: textOrNull,

  // Tab: Kategorisering
  main_category_id: textOrNull,
  sub_category_id: textOrNull,
  variant_of_product_id: textOrNull,
  product_page_id: textOrNull,
  statistics_group: textOrNull,

  // Tab: Produksjon
  production_group_id: textOrNull,
  is_production_group_main: z.boolean(),
  dough_type: textOrNull,
  lead_time_days: intOrNull,
  production_buffer: numOrNull,
  pieces_per_liter: numOrNull,
  pieces_per_tray: numOrNull,
  is_warehouse_item: z.boolean(),
  shelf_life_chilled_days: intOrNull,
  shelf_life_frozen_days: intOrNull,
  label_mode: z.enum(LABEL_MODES),
  label_print_model: z.enum(LABEL_PRINT_MODELS),
  label_profile_id: textOrNull,

  // Tab: Varedetaljer
  description_rich_md: textOrNull, // markdown-tekst, lagres som JSONB { format, text }
  image_url: textOrNull,
  datasheet_url: textOrNull,
  print_declaration_labels: z.boolean(),

  // Tab: Leveranse
  pause_delivery_from: dateOrNull,
  pause_delivery_to: dateOrNull,
  pause_reason: textOrNull,
  pause_reason_customer: textOrNull,

  // Tab: Pakke
  is_package: z.boolean(),

  // Tab: Retur
  allows_return: z.boolean(),
  return_price_type: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.enum(RETURN_PRICE_TYPES).nullable(),
  ),
  return_value: numOrNull,

  // Tab: Produksjon (Kakebygger-seksjon)
  is_cake_component: z.boolean(),
  cake_role: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.enum(CAKE_ROLES).nullable(),
  ),

  // Eksisterende felt vi beholder
  product_category: z.string().trim().min(1, "Kategori er påkrevd"),
  weight_per_unit_grams: numOrNull,
  variant_label: textOrNull,
  description: textOrNull,
  ean_code: textOrNull,
});

export type ProductFormValues = z.infer<typeof productSchema>;

/** Mapper en database-rad til form-verdier. */
export function productToFormValues(p: any): ProductFormValues {
  let mdText: string | null = null;
  if (p.description_rich && typeof p.description_rich === "object") {
    if (p.description_rich.format === "markdown" && typeof p.description_rich.text === "string") {
      mdText = p.description_rich.text;
    }
  }
  return {
    display_name: p.display_name ?? "",
    unit_of_sale: (p.unit_of_sale ?? "stk") as ProductFormValues["unit_of_sale"],
    is_divisible: !!p.is_divisible,
    pieces_per_unit: p.pieces_per_unit ?? null,
    is_for_sale: p.is_for_sale ?? true,
    in_web_shop: p.in_web_shop ?? false,
    include_in_price_lists: p.include_in_price_lists ?? true,
    in_pos: !!p.in_pos,
    gtin: p.gtin ?? null,
    epd_number: p.epd_number ?? null,
    mva_rate: Number(p.mva_rate ?? 15),
    eatin_mva_rate:
      p.eatin_mva_rate == null || p.eatin_mva_rate === undefined
        ? null
        : Number(p.eatin_mva_rate),
    mva_always_included: !!p.mva_always_included,
    account_reference: p.account_reference ?? null,

    main_category_id: p.main_category_id ?? null,
    sub_category_id: p.sub_category_id ?? null,
    variant_of_product_id: p.variant_of_product_id ?? null,
    product_page_id: p.product_page_id ?? null,
    statistics_group: p.statistics_group ?? null,

    production_group_id: p.production_group_id ?? null,
    is_production_group_main: !!p.is_production_group_main,
    dough_type: p.dough_type ?? null,
    lead_time_days: p.lead_time_days ?? null,
    production_buffer: p.production_buffer ?? null,
    pieces_per_liter: p.pieces_per_liter ?? null,
    pieces_per_tray: p.pieces_per_tray ?? null,
    is_warehouse_item: !!p.is_warehouse_item,
    shelf_life_chilled_days: p.shelf_life_chilled_days ?? null,
    shelf_life_frozen_days: p.shelf_life_frozen_days ?? null,
    label_mode: (p.label_mode ?? "none") as ProductFormValues["label_mode"],
    label_print_model: (p.label_print_model ?? "standard") as ProductFormValues["label_print_model"],
    label_profile_id: p.label_profile_id ?? null,

    description_rich_md: mdText,
    image_url: p.image_url ?? null,
    datasheet_url: p.datasheet_url ?? null,
    print_declaration_labels: !!p.print_declaration_labels,

    pause_delivery_from: p.pause_delivery_from ?? null,
    pause_delivery_to: p.pause_delivery_to ?? null,
    pause_reason: p.pause_reason ?? null,
    pause_reason_customer: p.pause_reason_customer ?? null,

    is_package: !!p.is_package,

    allows_return: !!p.allows_return,
    return_price_type: (p.return_price_type ?? null) as ProductFormValues["return_price_type"],
    return_value: p.return_value ?? null,

    is_cake_component: !!p.is_cake_component,
    cake_role: (p.cake_role ?? null) as ProductFormValues["cake_role"],

    product_category: p.product_category ?? "",
    weight_per_unit_grams: p.weight_per_unit_grams ?? null,
    variant_label: p.variant_label ?? null,
    description: p.description ?? null,
    ean_code: p.ean_code ?? null,
  };
}

/** Mapper form-verdier til database-payload (UPDATE products). */
export function formValuesToUpdatePayload(values: ProductFormValues): Record<string, unknown> {
  const description_rich = values.description_rich_md
    ? { format: "markdown", text: values.description_rich_md }
    : null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { description_rich_md, ...rest } = values;
  return { ...rest, description_rich };
}

/** Hvilken tab et felt tilhører — brukes for "switch til første tab med feil". */
export const FIELD_TO_TAB: Record<keyof ProductFormValues, string> = {
  display_name: "navn",
  unit_of_sale: "navn",
  is_divisible: "navn",
  pieces_per_unit: "navn",
  is_for_sale: "navn",
  in_web_shop: "navn",
  include_in_price_lists: "navn",
  in_pos: "navn",
  gtin: "navn",
  epd_number: "navn",
  mva_rate: "navn",
  eatin_mva_rate: "navn",
  mva_always_included: "navn",
  account_reference: "navn",

  main_category_id: "kategorisering",
  sub_category_id: "kategorisering",
  variant_of_product_id: "kategorisering",
  product_page_id: "kategorisering",
  statistics_group: "kategorisering",
  product_category: "kategorisering",

  production_group_id: "produksjon",
  is_production_group_main: "produksjon",
  dough_type: "produksjon",
  lead_time_days: "produksjon",
  production_buffer: "produksjon",
  pieces_per_liter: "produksjon",
  pieces_per_tray: "produksjon",
  is_warehouse_item: "produksjon",
  shelf_life_chilled_days: "produksjon",
  shelf_life_frozen_days: "produksjon",
  label_mode: "produksjon",
  label_print_model: "produksjon",
  label_profile_id: "produksjon",

  description_rich_md: "varedetaljer",
  image_url: "varedetaljer",
  datasheet_url: "varedetaljer",
  print_declaration_labels: "varedetaljer",

  pause_delivery_from: "leveranse",
  pause_delivery_to: "leveranse",
  pause_reason: "leveranse",
  pause_reason_customer: "leveranse",

  is_package: "pakke",

  allows_return: "retur",
  return_price_type: "retur",
  return_value: "retur",

  is_cake_component: "produksjon",
  cake_role: "produksjon",

  weight_per_unit_grams: "navn",
  variant_label: "kategorisering",
  description: "varedetaljer",
  ean_code: "navn",
};
