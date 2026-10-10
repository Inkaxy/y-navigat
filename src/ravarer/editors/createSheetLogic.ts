import type { ItemType } from "@/ravarer/lib/itemTypes";
import type { LinkSupplierItemBody } from "@/fakturaer/lib/supplierItems";
import { parseDecimal } from "@/ravarer/lib/packageMath";

export const CREATE_BASE_UNITS = ["kg", "l", "stk"] as const;
export type CreateBaseUnit = (typeof CREATE_BASE_UNITS)[number];
export const isCreateBaseUnit = (v: string | null | undefined): v is CreateBaseUnit =>
  !!v && (CREATE_BASE_UNITS as readonly string[]).includes(v);

export type AiConfidence = "høy" | "middels" | "lav";

/** Felt hentet fra datablad med AI. */
export interface DatasheetAiFields {
  name?: string;
  sku?: string;
  supplier_name?: string;
  package_size_value?: number;
  package_size_unit?: string;
  confidence?: Partial<Record<"name" | "sku" | "package", AiConfidence>>;
}

export interface CreatePrefill {
  name?: string;
  sku?: string;
  category?: string | null;
  baseUnit?: string;
  itemType?: ItemType;
  declarationName?: string;
  supplierId?: string | null;
  /** Standard for «Åpne råvarekortet etter lagring» (standalone). */
  openAfterSave?: boolean;
}

export type CreateContext =
  | { kind: "standalone"; prefill?: CreatePrefill }
  | { kind: "supplier_item"; supplierId: string; itemKey: string; lineIds?: string[]; invoiceId?: string; prefill?: CreatePrefill }
  | { kind: "datasheet"; datasheetId: string; fileName: string; aiFields: DatasheetAiFields };

export type WritePath = "create_raw_material" | "link_supplier_item" | "datasheet";

/** Hvilken skrivevei et skjema bruker — én per kontekst. */
export function writePathFor(ctx: CreateContext): WritePath {
  switch (ctx.kind) {
    case "standalone": return "create_raw_material";
    case "supplier_item": return "link_supplier_item";
    case "datasheet": return "datasheet";
  }
}

export interface CreateDraft {
  name: string;
  sku: string;
  itemType: ItemType;
  /** Tom streng = ingen kategori (lagres som null). */
  category: string;
  baseUnit: CreateBaseUnit;
  units: string;
  packageUnit: string;
  declarationName: string;
  primarySupplierId: string | null;
  openAfterSave: boolean;
}

/** Lesbart varenummer fra navnet når brukeren ikke har skrevet et. */
export function suggestSku(name: string, supplierSku?: string | null): string {
  const s = supplierSku?.trim();
  if (s) return s.toUpperCase();
  return name.trim().toUpperCase().replace(/[^A-ZÆØÅ0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
}

export function validateCreate(d: CreateDraft): string | null {
  if (!d.name.trim()) return "Skriv inn et navn";
  if (!isCreateBaseUnit(d.baseUnit)) return "Velg grunnenhet";
  if (d.units.trim() && d.packageUnit !== "bulk") {
    const n = parseDecimal(d.units);
    if (n == null || n <= 0) return "Pakningen må være et positivt tall";
  }
  return null;
}

export function packageOf(d: CreateDraft): { base_units_per_package: number; package_unit: string | null } | null {
  if (d.packageUnit === "bulk") return { base_units_per_package: 1, package_unit: "bulk" };
  const n = parseDecimal(d.units);
  if (n == null || n <= 0) return null;
  return { base_units_per_package: n, package_unit: d.packageUnit || null };
}

/** Body til `link-supplier-item` i opprett-modus (alle åpne linjer kobles og regnes om). */
export function linkCreateBody(
  ctx: Extract<CreateContext, { kind: "supplier_item" }>,
  d: CreateDraft,
  legalEntityId: string,
): LinkSupplierItemBody {
  const pkg = packageOf(d);
  return {
    legal_entity_id: legalEntityId,
    supplier_id: ctx.supplierId,
    item_key: ctx.itemKey,
    new_raw_material: {
      name: d.name.trim(),
      base_unit: d.baseUnit,
      item_type: d.itemType,
      sku: d.sku.trim() || suggestSku(d.name),
      ...(d.category ? { category: d.category } : {}),
      ...(d.declarationName.trim() ? { declaration_name: d.declarationName.trim().toLowerCase() } : {}),
    },
    ...(pkg ? { package: { base_units_per_package: pkg.base_units_per_package, ...(pkg.package_unit ? { package_unit: pkg.package_unit } : {}), confirm: true } } : {}),
    set_primary: true,
    ...(ctx.lineIds?.length ? { line_ids: ctx.lineIds } : {}),
  };
}

/** Body til `link-supplier-item` når brukeren velger en eksisterende råvare («Bruk denne»). */
export function linkExistingBody(
  ctx: Extract<CreateContext, { kind: "supplier_item" }>,
  rawMaterialId: string,
  legalEntityId: string,
): LinkSupplierItemBody {
  return {
    legal_entity_id: legalEntityId,
    supplier_id: ctx.supplierId,
    item_key: ctx.itemKey,
    raw_material_id: rawMaterialId,
    ...(ctx.lineIds?.length ? { line_ids: ctx.lineIds } : {}),
  };
}

export function initialDraft(ctx: CreateContext): CreateDraft {
  const base: CreateDraft = {
    name: "", sku: "", itemType: "ravare", category: "", baseUnit: "kg", units: "", packageUnit: "",
    declarationName: "", primarySupplierId: null, openAfterSave: ctx.kind === "standalone" && (ctx.prefill?.openAfterSave ?? true),
  };
  if (ctx.kind === "datasheet") {
    const a = ctx.aiFields;
    const u = a.package_size_unit?.toLowerCase() ?? "";
    const baseUnit: CreateBaseUnit = u === "g" || u === "kg" ? "kg" : u === "ml" || u === "l" ? "l" : u === "stk" ? "stk" : "kg";
    const size = a.package_size_value;
    const units = size == null ? "" : String(u === "g" || u === "ml" ? size / 1000 : size).replace(".", ",");
    return { ...base, name: a.name?.trim() ?? "", sku: a.sku?.trim() ?? "", baseUnit, units };
  }
  const p = ctx.prefill ?? {};
  return {
    ...base,
    name: p.name ?? "",
    sku: p.sku ?? "",
    itemType: p.itemType ?? "ravare",
    category: p.category ?? "",
    baseUnit: isCreateBaseUnit(p.baseUnit) ? p.baseUnit : "kg",
    declarationName: p.declarationName ?? "",
    primarySupplierId: ctx.kind === "supplier_item" ? ctx.supplierId : (p.supplierId ?? null),
  };
}
