import { supabase } from "@/integrations/supabase/client";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { ItemType } from "@/ravarer/lib/itemTypes";

export interface CreateRawMaterialInput {
  line: ReviewLineRow;
  name: string;
  sku: string;
  category: string;
  baseUnit: string;
  itemType: ItemType;
  /** Leverandørens eget varenummer — brukes som alias og på koblingen. */
  supplierSku: string | null;
  packageSize: number | null;
  packageUnit: string | null;
  baseUnitsPerPackage: number | null;
  /** Kostpris per baseenhet, eller null når den ikke kan regnes ut. */
  pricePerBaseUnit: number | null;
  baseQuantity: number | null;
}

/**
 * Oppretter én råvare fra en fakturalinje: vare, leverandørkobling, alias,
 * prishistorikk og match av linjen. Én kilde for både enkeltdialogen og
 * masse-opprettelsen, slik at de aldri kommer i utakt.
 */
export async function createRawMaterialFromLine(input: CreateRawMaterialInput): Promise<string> {
  const { line } = input;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const nowIso = new Date().toISOString();

  const { data: rm, error: rmErr } = await supabase
    .from("raw_materials")
    .insert({
      legal_entity_id: line.invoice.legal_entity_id,
      sku: input.sku.trim(),
      name: input.name.trim(),
      category: input.category.trim(),
      base_unit: input.baseUnit,
      item_type: input.itemType,
      package_size: input.packageSize,
      package_unit: input.packageUnit,
      current_cost_price: input.pricePerBaseUnit,
      price_source: "invoice",
      price_updated_at: nowIso,
      base_units_per_package: input.baseUnitsPerPackage,
      primary_supplier_id: line.invoice.supplier_id,
      is_active: true,
      created_by: user?.id,
    } as never)
    .select()
    .single();
  if (rmErr) throw rmErr;

  const { data: rms, error: rmsErr } = await supabase
    .from("raw_material_suppliers")
    .insert({
      raw_material_id: rm.id,
      supplier_id: line.invoice.supplier_id,
      is_primary: true,
      supplier_sku: input.supplierSku,
      supplier_product_name: line.description,
      // Avtaleprisen er forbeholdt framforhandlede priser — den røres ikke her.
      package_size: input.packageSize,
      package_unit: input.packageUnit,
      base_units_per_package: input.baseUnitsPerPackage,
      ...(input.packageSize != null ? { package_confirmed_at: nowIso, package_confirmed_by: user?.id ?? null } : {}),
      last_invoice_price: input.pricePerBaseUnit,
      last_invoice_date: line.invoice.invoice_date,
    })
    .select()
    .single();
  if (rmsErr) throw rmsErr;

  const aliases: Array<{
    raw_material_supplier_id: string;
    alias_type: "supplier_sku" | "product_name";
    alias_value: string;
    status: "confirmed";
    confirmed_by?: string;
    confirmed_at: string;
    first_seen_invoice_id: string;
  }> = [];
  if (input.supplierSku)
    aliases.push({
      raw_material_supplier_id: rms.id,
      alias_type: "supplier_sku",
      alias_value: input.supplierSku,
      status: "confirmed",
      confirmed_by: user?.id,
      confirmed_at: nowIso,
      first_seen_invoice_id: line.invoice_id,
    });
  if (line.description)
    aliases.push({
      raw_material_supplier_id: rms.id,
      alias_type: "product_name",
      alias_value: line.description,
      status: "confirmed",
      confirmed_by: user?.id,
      confirmed_at: nowIso,
      first_seen_invoice_id: line.invoice_id,
    });
  if (aliases.length) await supabase.from("raw_material_supplier_aliases").insert(aliases);

  if (input.pricePerBaseUnit != null) {
    await supabase.from("raw_material_price_history").insert({
      raw_material_id: rm.id,
      supplier_id: line.invoice.supplier_id,
      price: input.pricePerBaseUnit,
      effective_date: line.invoice.invoice_date,
      source: "invoice",
      invoice_id: line.invoice_id,
      created_by: user?.id,
    });
  }

  await supabase
    .from("invoice_lines")
    .update({
      raw_material_id: rm.id,
      match_confidence: "manual",
      requires_review: false,
      review_reason: null,
      resolved_by: user?.id,
      resolved_at: nowIso,
      price_per_base_unit: input.pricePerBaseUnit,
      base_quantity: input.baseQuantity,
    })
    .eq("id", line.id);

  return rm.id;
}
